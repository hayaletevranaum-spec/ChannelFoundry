import { useEffect, useMemo, useState } from "react";
import { useAiWorkbenchNotice } from "./AiWorkbenchStatus";
import { formatVideoDate as formatDate } from "./video-analysis-utils";
import "./analysis-curation.css";

type EditorialState = "pending" | "curated" | "excluded";
type UniverseDecision = "include" | "context" | "exclude";
type SupportDecision = "confirm" | "exclude";
type SortMode = "date-desc" | "date-asc" | "title-asc" | "title-desc";
type ReviewVideo = StudioAiAnalysisVideo & { editorialState?: "" | EditorialState; universeLocked?: boolean };
type EntityCandidate = { key:string; kind:string; name:string; aliases:string[]; state:"draft"|"approved" };
type EntityResolution = {
  status:"new"|"existing"|"ambiguous";
  kind:string;
  matchedBy:""|"name"|"alias";
  canonicalName:string;
  candidates:EntityCandidate[];
  recommendedDecision:UniverseDecision;
  needsReview:boolean;
  reason:string;
};
type EditorialItem = {
  key:string;
  category:string;
  label:string;
  detail:string;
  target:"universe"|"support";
  decision:UniverseDecision|SupportDecision;
  nameOverride?:string;
  resolution?:EntityResolution;
};
type EditorialPackage = {
  videoId:string;
  state:EditorialState;
  reviewedAt:string|null;
  manualSponsors:string[];
  manualContributors:string[];
  items:EditorialItem[];
  entityCatalog?:EntityCandidate[];
  universeLocked?:boolean;
};
type EditorialStats = StudioAiAnalysisStats & { editorialPending?:number; curated?:number; excluded?:number };
type EditorialBridge = NonNullable<typeof window.birdesengorStudio> & {
  aiAnalysisEditorial(videoId:string): Promise<EditorialPackage|null>;
  aiAnalysisEditorialSave(input:{ videoId:string; state:EditorialState; decisions:Record<string,UniverseDecision|SupportDecision>; nameOverrides:Record<string,string>; manualSponsors:string[]; manualContributors:string[] }): Promise<EditorialPackage>;
};

function errorText(error:unknown){ return error instanceof Error ? error.message : String(error); }
function names(value:string){ return [...new Set(value.split(/[\n,;]+/u).map((item)=>item.trim()).filter(Boolean))]; }
function stateText(value?:EditorialState|""){ return value === "curated" ? "Ayıklandı" : value === "excluded" ? "Evren dışı" : "İnceleme bekliyor"; }
function categoryText(value:string){ return ({storyHint:"Hikâye izi",storyBeat:"Anlatı ayrıntısı",character:"Muhatap",scene:"Olay / sahne",location:"Mekân",object:"Nesne",sponsor:"BirDeSenGör Defteri",contributor:"Katkıda bulunan"} as Record<string,string>)[value] || value; }
function canRename(item:EditorialItem){ return item.category === "character" || item.category === "location" || item.category === "object"; }
function normalized(value:string){ return value.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g," "); }
function kindForCategory(category:string){ return category === "character" ? "character" : category === "location" ? "location" : category === "object" ? "object" : ""; }
function entityListId(category:string){ return `analysis-curation-${category}-entities`; }
function includeLabel(item:EditorialItem){ return item.resolution?.status === "existing" ? "Mevcut kayda katkı" : "Evrene aktar"; }
function resolutionLabel(item:EditorialItem, decision:UniverseDecision){
  if(item.resolution?.status === "ambiguous") return "Eşleşme gerekli";
  if(item.resolution?.status === "new") return "Yeni kayıt";
  if(item.resolution?.status === "existing") return decision === "include" ? "Mevcut kayda katkı" : decision === "context" ? "Yalnız bağlam" : "Hariç";
  return "";
}

export default function AnalysisCurationWorkbench(){
  const bridge = window.birdesengorStudio as EditorialBridge | undefined;
  const notify = useAiWorkbenchNotice();
  const [videos,setVideos] = useState<ReviewVideo[]>([]);
  const [stats,setStats] = useState<EditorialStats>({transcripts:0,analyzed:0,waiting:0,running:0,errors:0});
  const [filter,setFilter] = useState<"pending"|"curated"|"excluded"|"all">("pending");
  const [sort,setSort] = useState<SortMode>("date-desc");
  const [query,setQuery] = useState("");
  const [selectedId,setSelectedId] = useState<string|null>(null);
  const [review,setReview] = useState<EditorialPackage|null>(null);
  const [decisions,setDecisions] = useState<Record<string,UniverseDecision|SupportDecision>>({});
  const [nameOverrides,setNameOverrides] = useState<Record<string,string>>({});
  const [manualSponsors,setManualSponsors] = useState("");
  const [manualContributors,setManualContributors] = useState("");
  const [showAllUniverseItems,setShowAllUniverseItems] = useState(false);
  const [busy,setBusy] = useState(false);

  const load = async()=>{
    if(!bridge) return;
    const [list,nextStats] = await Promise.all([bridge.aiAnalysisList(),bridge.aiAnalysisStats()]);
    const analyzed = (list as ReviewVideo[]).filter((video)=>video.hasAnalysis);
    setVideos(analyzed);
    setStats(nextStats as EditorialStats);
    setSelectedId((current)=> current && analyzed.some((video)=>video.videoId===current) ? current : analyzed[0]?.videoId ?? null);
  };

  useEffect(()=>{
    void load().catch((reason)=>notify(errorText(reason),"error"));
    return bridge?.onDataChanged?.(()=>{void load().catch(()=>undefined);});
  },[]);

  useEffect(()=>{
    setShowAllUniverseItems(false);
    if(!bridge || !selectedId){ setReview(null); return; }
    let canceled=false;
    void bridge.aiAnalysisEditorial(selectedId).then((next)=>{
      if(canceled) return;
      setReview(next);
      setDecisions(Object.fromEntries((next?.items ?? []).map((item)=>[item.key,item.decision])));
      setNameOverrides(Object.fromEntries((next?.items ?? []).filter(canRename).map((item)=>[item.key,item.nameOverride ?? ""])));
      setManualSponsors((next?.manualSponsors ?? []).join("\n"));
      setManualContributors((next?.manualContributors ?? []).join("\n"));
    }).catch((reason)=>{ if(!canceled) notify(errorText(reason),"error"); });
    return()=>{canceled=true;};
  },[bridge,selectedId]);

  const filtered = useMemo(()=>{
    const term=query.trim().toLocaleLowerCase("tr-TR");
    return videos.filter((video)=>{
      const state=video.editorialState || "pending";
      if(filter!=="all" && state!==filter) return false;
      return !term || `${video.title} ${video.videoId}`.toLocaleLowerCase("tr-TR").includes(term);
    }).map((video,index)=>({video,index})).sort((left,right)=>{
      const leftDate=left.video.publishedAt || "";
      const rightDate=right.video.publishedAt || "";
      const dateComparison=leftDate.localeCompare(rightDate);
      const titleComparison=left.video.title.localeCompare(right.video.title,"tr-TR",{sensitivity:"base"});
      let comparison=0;
      if(sort==="date-desc") comparison=-dateComparison || titleComparison;
      else if(sort==="date-asc") comparison=dateComparison || titleComparison;
      else if(sort==="title-desc") comparison=-titleComparison || -dateComparison;
      else comparison=titleComparison || -dateComparison;
      return comparison || left.index-right.index;
    }).map(({video})=>video);
  },[videos,filter,query,sort]);

  useEffect(()=>{
    if(selectedId && filtered.some((video)=>video.videoId===selectedId)) return;
    setSelectedId(filtered[0]?.videoId ?? null);
  },[filter,query,sort,filtered.length]);

  const selected=videos.find((video)=>video.videoId===selectedId) ?? null;
  const universeItems=review?.items.filter((item)=>item.target==="universe") ?? [];
  const supportItems=review?.items.filter((item)=>item.target==="support") ?? [];
  const universeLocked=Boolean(review?.universeLocked);
  const decisionCounts = useMemo(()=>{
    const result = { include:0, context:0, exclude:0 };
    for(const item of universeItems){
      const decision=(decisions[item.key] ?? item.decision) as UniverseDecision;
      result[decision] += 1;
    }
    return result;
  },[universeItems,decisions]);
  const resolutionCounts = useMemo(()=>{
    const result={contribution:0,newRecord:0,contextOnly:0,review:0};
    for(const item of universeItems){
      const resolution=item.resolution;
      if(!resolution) continue;
      const decision=(decisions[item.key] ?? item.decision) as UniverseDecision;
      if(resolution.needsReview) result.review += 1;
      if(resolution.status==="new" && decision==="include") result.newRecord += 1;
      if(resolution.status==="existing" && decision==="include") result.contribution += 1;
      if(resolution.status==="existing" && decision==="context") result.contextOnly += 1;
    }
    return result;
  },[universeItems,decisions]);
  const reviewRequiredItems=useMemo(()=>universeItems.filter((item)=>item.resolution?.needsReview),[universeItems]);
  const visibleUniverseItems=universeLocked || showAllUniverseItems ? universeItems : reviewRequiredItems;
  const automaticCount=Math.max(0,universeItems.length-reviewRequiredItems.length);

  const save=async(state:EditorialState)=>{
    if(!bridge || !selectedId || !review || busy) return;
    if(state==="excluded" && !confirm("Bu video evren üretiminden çıkarılsın mı? Ham çözümleme ve destek kayıtları saklanır.")) return;
    setBusy(true);
    try{
      const saved=await bridge.aiAnalysisEditorialSave({videoId:selectedId,state,decisions,nameOverrides,manualSponsors:names(manualSponsors),manualContributors:names(manualContributors)});
      setReview(saved);
      await load();
      notify(
        universeLocked
          ? "Destek kayıtları güncellendi; Evrene işlenmiş malzeme kilitli kaldı."
          : state==="curated"
            ? `${decisionCounts.include} öğe Evrene aktarılacak, ${decisionCounts.context} öğe yalnız bağlam olarak saklanacak.`
            : state==="excluded"
              ? "Video evren üretiminden çıkarıldı; ham kayıt korundu."
              : "Ayıklama kararları kaydedildi.",
        "success",
      );
    }catch(reason){
      notify(errorText(reason),"error");
    }finally{
      setBusy(false);
    }
  };

  if(!bridge) return <div className="panel analysis-curation-empty">Editoryal ayıklama Electron Studio içinde kullanılabilir.</div>;

  return <div className="analysis-curation-workbench">
    <div className="analysis-curation-summary">
      <span><b>{stats.analyzed}</b> çözümleme</span>
      <span><b>{stats.editorialPending ?? 0}</b> inceleme</span>
      <span><b>{stats.curated ?? 0}</b> evrene hazır</span>
      <span><b>{stats.excluded ?? 0}</b> evren dışı</span>
    </div>
    <div className="analysis-curation-layout">
      <section className="panel analysis-curation-list">
        <header>
          <input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Çözümlenmiş videolarda ara…"/>
          <select value={filter} onChange={(event)=>setFilter(event.target.value as typeof filter)}>
            <option value="pending">İnceleme bekleyen</option>
            <option value="curated">Ayıklananlar</option>
            <option value="excluded">Evren dışı</option>
            <option value="all">Tümü</option>
          </select>
          <select aria-label="Liste sıralaması" value={sort} onChange={(event)=>setSort(event.target.value as SortMode)}>
            <option value="date-desc">Tarih · Yeni → Eski</option>
            <option value="date-asc">Tarih · Eski → Yeni</option>
            <option value="title-asc">Ad · A → Z</option>
            <option value="title-desc">Ad · Z → A</option>
          </select>
        </header>
        <div>
          {filtered.map((video)=><button key={video.videoId} className={selectedId===video.videoId?"active":""} onClick={()=>setSelectedId(video.videoId)}>
            <span><strong>{video.title}</strong><small>{formatDate(video.publishedAt)}</small></span>
            <em className={video.editorialState || "pending"}>{video.universeLocked ? "Evrene işlendi" : stateText(video.editorialState)}</em>
          </button>)}
          {!filtered.length && <p>Bu filtrede kayıt yok.</p>}
        </div>
      </section>

      <section className="panel analysis-curation-detail">
        {selected && review ? <>
          <header>
            <div>
              <small>EDİTORYAL AYIKLAMA</small>
              <h3>{selected.title}</h3>
              <p>Studio mevcut Evren kayıtlarını isim ve lakaplarla eşleştirir. Normal durumda yalnız “eşleşme gerekli” görünen satırlara müdahale etmen yeterli.</p>
            </div>
            <span className={`analysis-curation-state ${review.state}`}>{universeLocked ? "Evrene işlendi" : stateText(review.state)}</span>
          </header>

          <section>
            <small>EVREN MALZEMESİ</small>
            <h4>Bu videodan ne kalsın?</h4>
            {universeLocked && <p>Bu video Evrene işlendiği için ayıklama kararları kilitlendi. Evren içeriğinde değişiklik gerekiyorsa ilgili kaydı doğrudan düzenle veya tam Evren yeniden oluşturma akışını kullan.</p>}
            {!universeLocked && <div className="analysis-curation-decision-summary">
              <span><b>{resolutionCounts.contribution}</b> mevcut kayda katkı</span>
              <span><b>{resolutionCounts.newRecord}</b> yeni kayıt</span>
              <span><b>{resolutionCounts.review}</b> kontrol gerekli</span>
              <p>{resolutionCounts.contextOnly} mevcut kayıt yalnız bağlam olarak geçiyor. Studio açık isim/lakap eşleşmelerini otomatik seçer; “kontrol gerekli” sıfırsa genellikle tek tek seçim yapmadan Ayıklamayı tamamlayabilirsin.</p>
            </div>}

            {(["character","location","object"] as const).map((category)=>{
              const kind=kindForCategory(category);
              const options=(review.entityCatalog ?? []).filter((entry)=>entry.kind===kind);
              return <datalist id={entityListId(category)} key={category}>{options.map((entry)=><option key={entry.key} value={entry.name}/>)}</datalist>;
            })}

            {!universeLocked && <div className="analysis-curation-auto-summary">
              <div>
                <strong>{resolutionCounts.review ? `${resolutionCounts.review} karar senden kontrol bekliyor` : "Otomatik kararlar hazır"}</strong>
                <p>{resolutionCounts.review ? `${automaticCount} karar otomatik çözüldü; aşağıda yalnız belirsiz eşleşmeler gösteriliyor.` : `${automaticCount} karar otomatik çözüldü. Tek tek satırları açmadan Ayıklamayı tamamlayabilirsin.`}</p>
              </div>
              <button className="text-button" type="button" onClick={()=>setShowAllUniverseItems((current)=>!current)}>{showAllUniverseItems ? "Yalnız kontrol gerekenleri göster" : `Tüm kararları göster (${universeItems.length})`}</button>
            </div>}

            {visibleUniverseItems.length > 0 ? <div className="analysis-curation-items">
              {visibleUniverseItems.map((item)=>{
                const decision=(decisions[item.key] ?? item.decision) as UniverseDecision;
                const override=nameOverrides[item.key] ?? item.nameOverride ?? "";
                const changed=Boolean(override.trim() && normalized(override)!==normalized(item.label));
                const resolution=item.resolution;
                const candidateNames=resolution?.status==="ambiguous" ? resolution.candidates.map((candidate)=>candidate.name).join(", ") : "";
                return <article key={item.key}>
                  <div>
                    <small>{categoryText(item.category)}</small>
                    <strong>{item.label}</strong>
                    {resolution && <p><b>{resolutionLabel(item,decision)}</b>{resolution.canonicalName ? ` → ${resolution.canonicalName}` : ""}. {resolution.reason}{candidateNames ? ` Adaylar: ${candidateNames}.` : ""}</p>}
                    {item.detail && <p>{item.detail}</p>}
                    {!universeLocked && canRename(item) && decision!=="exclude" && <label className="analysis-curation-name-edit">
                      <span>Kayıt adı</span>
                      <input
                        disabled={busy}
                        value={override}
                        list={entityListId(item.category)}
                        onChange={(event)=>setNameOverrides((current)=>({...current,[item.key]:event.target.value}))}
                        placeholder={resolution?.canonicalName || item.label}
                      />
                      {changed && <em>Çözümlemedeki ad: {item.label}</em>}
                    </label>}
                  </div>
                  <select disabled={busy || review.state==="excluded" || universeLocked} value={decision} onChange={(event)=>setDecisions((current)=>({...current,[item.key]:event.target.value as UniverseDecision}))}>
                    <option value="include">{includeLabel(item)}</option>
                    <option value="context">Yalnız bağlam</option>
                    <option value="exclude">Hariç tut</option>
                  </select>
                </article>;
              })}
            </div> : !universeLocked && <div className="analysis-curation-auto-empty">Bu videoda elle çözmen gereken Evren eşleşmesi yok.</div>}
          </section>

          <section className="analysis-curation-support">
            <small>KANAL DESTEK KAYITLARI</small>
            <h4>Evren dışında tutulan isimler</h4>
            <p>Sponsorlar ve katkıda bulunanlar hiçbir zaman Muhatap veya Evren ilişkisi oluşturmaz.</p>
            <div className="analysis-curation-items">
              {supportItems.map((item)=><article key={item.key}>
                <div><small>{categoryText(item.category)}</small><strong>{item.label}</strong></div>
                <select disabled={busy} value={decisions[item.key] ?? item.decision} onChange={(event)=>setDecisions((current)=>({...current,[item.key]:event.target.value as SupportDecision}))}>
                  <option value="confirm">Onayla</option>
                  <option value="exclude">Hariç tut</option>
                </select>
              </article>)}
            </div>
            <div className="analysis-curation-manual">
              <label>BirDeSenGör Defteri · manuel<textarea value={manualSponsors} onChange={(event)=>setManualSponsors(event.target.value)} placeholder="Her satıra bir sponsor…"/></label>
              <label>Katkıda bulunanlar · manuel<textarea value={manualContributors} onChange={(event)=>setManualContributors(event.target.value)} placeholder="Her satıra bir isim…"/></label>
            </div>
          </section>

          <footer>
            {universeLocked ? <>
              <span>Evren malzemesi kilitli · yalnız destek kayıtları düzenlenebilir.</span>
              <button className="primary-button" disabled={busy} onClick={()=>void save("curated")}>Destek kayıtlarını kaydet</button>
            </> : <>
              <button className="text-button" disabled={busy} onClick={()=>void save("pending")}>Kararları kaydet</button>
              <button className="secondary-button" disabled={busy} onClick={()=>void save("excluded")}>Videoyu evren dışı bırak</button>
              <button className="primary-button" disabled={busy} onClick={()=>void save("curated")}>Ayıklamayı tamamla</button>
            </>}
          </footer>
        </> : <div className="analysis-curation-empty"><h3>İncelemek için çözümlenmiş bir video seç.</h3></div>}
      </section>
    </div>
  </div>;
}
