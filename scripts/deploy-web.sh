#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
ChannelFoundry Web uygulamasını yapılandırılmış bir SSH hedefine yayınlar.

Kullanım:
  npm run deploy:web -- [seçenekler]

Seçenekler:
  --dry-run      Sunucuda değişiklik yapmadan farkları gösterir.
  --skip-build   Mevcut apps/web/dist çıktısını kullanır.
  --yes          Etkileşimli onay istemeden yayınlar.
  --help         Bu yardımı gösterir.

Gerekli ortam değişkenleri:
  CHANNEL_FOUNDRY_DEPLOY_HOST        SSH hedefi (ör. user@example.com)
  CHANNEL_FOUNDRY_DEPLOY_ROOT        Uzak web kökü (ör. /srv/www/site)

İsteğe bağlı ortam değişkenleri:
  CHANNEL_FOUNDRY_DEPLOY_BACKUP_DIR  Uzak yedek dizini; varsayılan: web kökünün yanında deploy-backups
  CHANNEL_FOUNDRY_PUBLIC_URL         Canlı site adresi; verilirse HTTP smoke testi yapılır

Script Studio tarafından yönetilen content/publication.json, content/community-credits.json,
content/assets/ ve sunucudaki *.bak-* dosyalarına dokunmaz.
EOF
}

dry_run=false
skip_build=false
assume_yes=false

while (($# > 0)); do
  case "$1" in
    --dry-run) dry_run=true ;;
    --skip-build) skip_build=true ;;
    --yes) assume_yes=true ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Bilinmeyen seçenek: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
dist_dir="$project_root/apps/web/dist"

deploy_host="${CHANNEL_FOUNDRY_DEPLOY_HOST:-}"
remote_root="${CHANNEL_FOUNDRY_DEPLOY_ROOT:-}"
public_url="${CHANNEL_FOUNDRY_PUBLIC_URL:-}"

if [[ -z "$deploy_host" || -z "$remote_root" ]]; then
  printf 'Deploy hedefi yapılandırılmamış. CHANNEL_FOUNDRY_DEPLOY_HOST ve CHANNEL_FOUNDRY_DEPLOY_ROOT gerekli.\n\n' >&2
  usage >&2
  exit 2
fi

remote_root="${remote_root%/}"
remote_parent="${remote_root%/*}"
backup_dir="${CHANNEL_FOUNDRY_DEPLOY_BACKUP_DIR:-$remote_parent/deploy-backups}"
backup_dir="${backup_dir%/}"

if [[ ! "$deploy_host" =~ ^[A-Za-z0-9._@-]+$ ]]; then
  printf 'Geçersiz SSH hedefi: %s\n' "$deploy_host" >&2
  exit 2
fi
for remote_path in "$remote_root" "$backup_dir"; do
  if [[ ! "$remote_path" =~ ^/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)+$ ]]; then
    printf 'Güvenli olmayan uzak yol: %s\n' "$remote_path" >&2
    exit 2
  fi
done

required_commands=(npm ssh rsync php)
for command_name in "${required_commands[@]}"; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Gerekli komut bulunamadı: %s\n' "$command_name" >&2
    exit 1
  fi
done

ssh_options=(-o BatchMode=yes -o ConnectTimeout=15)
rsync_ssh="ssh -o BatchMode=yes -o ConnectTimeout=15"
rsync_excludes=(
  '--exclude=/content/publication.json'
  '--exclude=/content/community-credits.json'
  '--exclude=/content/assets/***'
  '--exclude=/content/*.bak-*'
  '--exclude=*.bak-*'
)

# rsync itemized output can contain entries such as `.f          file` for
# regular files that are not being updated. Only exact no-change item tokens
# are ignored; attribute changes, transfers and deletes remain visible.
filter_rsync_changes() {
  awk '$1 !~ /^\.[fdLDS]$/'
}

cd -- "$project_root"

if [[ "$skip_build" == false ]]; then
  printf 'Web uygulaması derleniyor...\n'
  npm run build:web
fi

if [[ ! -f "$dist_dir/index.html" || ! -d "$dist_dir/api" ]]; then
  printf 'Build çıktısı bulunamadı: %s/index.html\n' "$dist_dir" >&2
  exit 1
fi

printf 'PHP dosyaları doğrulanıyor...\n'
while IFS= read -r -d '' php_file; do
  php -l "$php_file" >/dev/null
done < <(find "$dist_dir/api" -type f -name '*.php' -print0)

printf 'SSH bağlantısı ve hedef dizin doğrulanıyor...\n'
ssh "${ssh_options[@]}" "$deploy_host" "test -d '$remote_root' && command -v rsync >/dev/null && command -v php >/dev/null"
ssh "${ssh_options[@]}" "$deploy_host" "command -v tar >/dev/null"

printf '\nHedef: %s:%s\n' "$deploy_host" "$remote_root"
printf 'Korunan: content/publication.json, content/community-credits.json, content/assets/, *.bak-*\n\n'

if [[ "$dry_run" == true ]]; then
  printf 'Dry-run değişiklikleri:\n'
  dry_changes="$(rsync -aznci --delete --omit-dir-times --itemize-changes "${rsync_excludes[@]}" -e "$rsync_ssh" "$dist_dir/" "$deploy_host:$remote_root/" 2>&1 | filter_rsync_changes)"
  if [[ -n "$dry_changes" ]]; then
    printf '%s\n' "$dry_changes"
  else
    printf 'Değişiklik yok.\n'
  fi
  printf '\nDry-run tamamlandı; sunucuda değişiklik yapılmadı.\n'
  exit 0
fi

if [[ "$assume_yes" == false ]]; then
  if [[ ! -t 0 ]]; then printf 'Etkileşimsiz yayın için --yes kullanın.\n' >&2; exit 2; fi
  read -r -p 'Bu build yapılandırılmış canlı web hedefine yayınlansın mı? [e/H] ' answer
  if [[ ! "$answer" =~ ^[eEyY]$ ]]; then printf 'Yayın iptal edildi.\n'; exit 0; fi
fi

deploy_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
remote_stage="${remote_root}.deploy-stage-${deploy_stamp}-$$"
backup_file="$backup_dir/web-${deploy_stamp}.tar.gz"
stage_created=false

cleanup_stage() {
  if [[ "$stage_created" != true ]]; then return; fi
  ssh "${ssh_options[@]}" "$deploy_host" "if [ -d '$remote_stage' ]; then find '$remote_stage' -depth -delete; fi" >/dev/null 2>&1 || printf 'Uyarı: geçici uzak dizin temizlenemedi: %s\n' "$remote_stage" >&2
}
trap cleanup_stage EXIT

printf 'Geçici yayın alanı hazırlanıyor...\n'
ssh "${ssh_options[@]}" "$deploy_host" "test ! -e '$remote_stage' && mkdir -p '$remote_stage' '$backup_dir'"
stage_created=true
rsync -az --delete --omit-dir-times "${rsync_excludes[@]}" -e "$rsync_ssh" "$dist_dir/" "$deploy_host:$remote_stage/"

printf 'Sunucudaki PHP dosyaları doğrulanıyor...\n'
ssh "${ssh_options[@]}" "$deploy_host" "find '$remote_stage/api' -type f -name '*.php' -exec php -l {} \; >/dev/null"

printf 'Mevcut web sürümü yedekleniyor...\n'
ssh "${ssh_options[@]}" "$deploy_host" "test ! -e '$backup_file' && tar --exclude='./content/publication.json' --exclude='./content/community-credits.json' --exclude='./content/assets' --exclude='*.bak-*' -czf '$backup_file' -C '$remote_root' ."

printf 'Yeni sürüm etkinleştiriliyor...\n'
ssh "${ssh_options[@]}" "$deploy_host" "rsync -a --delete --omit-dir-times --exclude='/content/publication.json' --exclude='/content/community-credits.json' --exclude='/content/assets/***' --exclude='/content/*.bak-*' --exclude='*.bak-*' '$remote_stage/' '$remote_root/'"

printf 'Yayınlanan dosyalar karşılaştırılıyor...\n'
verification="$(rsync -aznci --delete --omit-dir-times --itemize-changes "${rsync_excludes[@]}" -e "$rsync_ssh" "$dist_dir/" "$deploy_host:$remote_root/" 2>&1 | filter_rsync_changes)"
if [[ -n "$verification" ]]; then
  printf 'Yayın doğrulaması fark buldu:\n%s\n' "$verification" >&2
  printf 'Yedek: %s\n' "$backup_file" >&2
  exit 1
fi

if [[ -n "$public_url" ]]; then
  if ! command -v curl >/dev/null 2>&1; then
    printf 'CHANNEL_FOUNDRY_PUBLIC_URL verildi ancak curl bulunamadı; HTTP smoke testi atlandı.\n' >&2
  else
    printf 'Canlı site ve API sağlık kontrolü yapılıyor...\n'
    curl --fail --silent --show-error --max-time 20 "${public_url%/}/" >/dev/null
    curl --fail --silent --show-error --max-time 20 "${public_url%/}/api/studio/?action=health" >/dev/null
  fi
else
  printf 'CHANNEL_FOUNDRY_PUBLIC_URL verilmedi; HTTP smoke testi atlandı.\n'
fi

printf '\nYayın tamamlandı.\n'
if [[ -n "$public_url" ]]; then printf 'Canlı adres: %s\n' "$public_url"; fi
printf 'Sunucu yedeği: %s\n' "$backup_file"
printf 'Publication v2 paketi ve semantik asset dosyaları korundu.\n'
