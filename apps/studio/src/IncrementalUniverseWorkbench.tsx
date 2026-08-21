import { useEffect, useState } from "react";
import { useAiWorkbenchNotice } from "./AiWorkbenchStatus";
import "./universe-batch-selection.css";

type PendingSource = { videoId:string; title:string; publishedAt:string };
type MergeResult = StudioUniverseMergeResult & { sources?:PendingSource[] };
type MergeStatus = StudioUniverseMergeStatus & { ingest?: { pending?:number; processed?:number; newSources?:number; changedSources?:number; awaitingApplyRunId?:number|null; batchLimit?:number; nextSources?:PendingSource[]; backlog?:{ drafts?:number; revisions?:number; total?:number; blocking?:number } } };
type WorkspaceStatus = StudioUniverseWorkspaceStatus & { counts: StudioUniverseWorkspaceStatus["counts"] & { pendingRevisions?:number } };
type ApplyResult = WorkspaceStatus & { created?:number; updated?:number; revisionProposed?:number; ingestProcessed?:number };
type ResultCategory = "stories"|"characters"|"events"|"locations"|"objects"|"relations";
type ResultEntry = { key:string; title:string; label:string; summary:string; sourceVideoIds:string[]; details:string[] };

const n=(value:number)=>new Intl.NumberFormat("tr-TR").format(Math.max(0,value));
const err=(value:unknown)=>value instanceof Error?value.message:String(value);
const resultCategories:Array<{key:ResultCategory;label:string}>=[
  {key:"stories",label:"Hikâyeler"},{key:"characters",label:"Muhataplar"},{key:"events",label:"Olaylar"},{key:"locations",label:"Mekânlar"},{key:"objects",label:"Nesneler"},{key:"relations",label:"Bağlantılar"},
];
const relationKind=(value:StudioUniverseRelation["fromType"])=>({story:"Hikâye",character:"Muhatap",event:"Olay",location:"Mekân",object:"Nesne"})[value];

function resultEntries(universe:StudioUniverse,category:ResultCategory):ResultEntry[]{
  if(category==="stories")return universe.stories.map((entry,index)=>({key:`story:${entry.name}:${index}`,title:entry.name,label:"Hikâye",summary:entry.summary,sourceVideoIds:entry.sourceVideoIds,details:entry.sequence.map((detail)=>detail.text)}));
  if(category==="characters")return universe.characters.map((entry,index)=>({key:`character:${entry.name}:${index}`,title:entry.name,label:entry.roles?.join(" · ")||"Muhatap",summary:entry.summary,sourceVideoIds:entry.sourceVideoIds,details:entry.details.map((detail)=>detail.text)}));
  if(category==="events")return universe.events.map((entry,index)=>({key:`event:${entry.name}:${index}`,title:entry.name,label:"Olay",summary:entry.summary,sourceVideoIds:entry.sourceVideoIds,details:[]}));
  if(category==="locations")return universe.locations.map((entry,index)=>({key:`location:${entry.name}:${index}`,title:entry.name,label:"Mekân",summary:entry.summary,sourceVideoIds:entry.sourceVideoIds,details:entry.details.map((detail)=>detail.text)}));
  if(category==="objects")return universe.objects.map((entry,index)=>({key:`object:${entry.name}:${index}`,title:entry.name,label:"Nesne",summary:entry.summary,sourceVideoIds:entry.sourceVideoIds,details:entry.details.map((detail)=>detail.text)}));
  return universe.relations.map((entry,index)=>({key:`relation:${entry.fromName}:${entry.toName}:${index}`,title:`${entry.fromName} → ${entry.toName}`,label:entry.label||"Bağlantı",summary:`${relationKind(entry.fromType)} → ${relationKind(entry.toType)}`,sourceVideoIds:entry.sourceVideoIds,details:[]}));
}

export default function IncrementalUniverseWorkbench(){
  const bridge=window.birdesengorStudio;
  const notify=useAiWorkbenchNotice();
  const [status,setStatus]=useState<MergeStatus>({availableAnalyses:0,run:null});
  const [workspace,setWorkspace]=useState<WorkspaceStatus|null>(null);
  const [result,setResult]=useState<MergeResult|null>(null);
  const [busy,setBusy]=useState(false);
  const [selectedVideoIds,setSelectedVideoIds]=useState<string[]>([]);
  const [selectionSignature,setSelectionSignature]=useState("");
  const [resultCategory,setResultCategory]=useState<ResultCategory>("stories");
  const [selectedResultKey,setSelectedResultKey]=useState<string|null>(null);

  const load=async()=>{
    if(!bridge)return;
    const [merge,editorial]=await Promise.all([bridge.universeMergeStatus(),bridge.universeWorkspaceStatus()]);
    const next=merge as MergeStatus;
    const nextWorkspace=editorial as WorkspaceStatus;
    setStatus(next);setWorkspace(nextWorkspace);
    const latestApplied=nextWorkspace.latestImport?.runId??null;
    const currentReviewable=next.run&&["done","error"].includes(next.run.state)&&next.run.id!==latestApplied?next.run.id:null;
    const runId=next.ingest?.awaitingApplyRunId??currentReviewable;
    setResult(runId?(await bridge.universeMergeResult(runId) as MergeResult|null):null);
  };
  useEffect(()=>{void load().catch((e)=>notify(err(e),"error"));return bridge?.onDataChanged?.(()=>{void load().catch(()=>undefined);});},[]);
  useEffect(()=>{if(!status.run||!["waiting","running"].includes(status.run.state))return;const timer=window.setInterval(()=>void load(),1800);return()=>window.clearInterval(timer);},[status.run?.id,status.run?.state]);

  const nextSources=status.ingest?.nextSources??[];
  const nextSignature=nextSources.map((source)=>source.videoId).join("|");
  useEffect(()=>{
    if(nextSignature===selectionSignature)return;
    setSelectionSignature(nextSignature);
    setSelectedVideoIds(nextSources.map((source)=>source.videoId));
  },[nextSignature,selectionSignature]);

  if(!bridge)return <div className="panel universe-empty">Evrene İşleme Studio içinde kullanılabilir.</div>;

  const pending=status.ingest?.pending??status.availableAnalyses;
  const processed=status.ingest?.processed??0;
  const batchLimit=status.ingest?.batchLimit??10;
  const drafts=status.ingest?.backlog?.drafts??workspace?.counts.draft??0;
  const revisions=status.ingest?.backlog?.revisions??workspace?.counts.pendingRevisions??0;
  const awaiting=status.ingest?.awaitingApplyRunId??null;
  const active=Boolean(status.run&&["waiting","running"].includes(status.run.state));
  const failed=status.run?.state==="error";
  const currentRunApplied=Boolean(status.run&&workspace?.latestImport?.runId===status.run.id);
  const complete=Boolean(result?.state==="done"&&(result.complete??result.sourceCoverage?.actual===result.sourceCoverage?.expected));
  const applied=Boolean(result&&workspace?.latestImport?.runId===result.id);
  const canCancel=Boolean(status.run&&!active&&!currentRunApplied&&["done","error"].includes(status.run.state));
  const canStart=selectedVideoIds.length>0&&!active&&!awaiting&&!failed&&!revisions&&!busy;

  const start=async()=>{
    if(!canStart||!confirm(`${selectedVideoIds.length} seçili kaynak Evrene işlensin mi? Seçilmeyen kaynaklar sırada kalır; daha önce işlenmiş kaynaklar tekrar işlenmez.`))return;
    setBusy(true);try{await bridge.universeMergeStart({videoIds:selectedVideoIds});await load();notify(`Evrene İşleme başladı; en eski pencere içinden ${selectedVideoIds.length} kaynak kullanılıyor.`,"success");}catch(e){notify(err(e),"error");}finally{setBusy(false);}
  };
  const stop=async()=>{
    if(!active)return;setBusy(true);try{await bridge.universeMergeCancel();await load();notify("Evrene İşleme durduruldu; seçilen kaynaklar sırada kaldı ve mevcut Evren korunuyor.","success");}catch(e){notify(err(e),"error");}finally{setBusy(false);}
  };
  const cancelPrepared=async()=>{
    if(!canCancel||!status.run)return;
    const sourceCount=result?.sources?.length??status.run.analysisCount;
    if(!confirm(`Çalışma #${status.run.id} iptal edilsin mi? ${sourceCount} kaynak Evrene işlenmiş sayılmayacak ve yeniden sırada kalacak. Mevcut 04 · İnceleme kayıtları değişmeyecek.`))return;
    setBusy(true);try{const canceled=await bridge.universeMergeCancel();await load();setSelectedResultKey(null);notify(canceled.canceled?`Çalışma #${canceled.runId} iptal edildi; ${sourceCount} kaynak yeniden Evrene İşleme sırasına bırakıldı.`:"İptal edilecek çalışma bulunamadı.",canceled.canceled?"success":"error");}catch(e){notify(err(e),"error");}finally{setBusy(false);}
  };
  const apply=async()=>{
    if(!result||result.state!=="done"||applied||!complete||busy||!confirm(`Çalışma #${result.id} 04 · İnceleme aşamasına aktarılsın mı? Bu noktadan sonra kaynaklar işlenmiş olarak kilitlenecek.`))return;
    setBusy(true);try{const next=await bridge.universeWorkspaceApply(result.id) as ApplyResult;await load();notify(`${next.created??0} yeni kayıt · ${next.updated??0} taslak güncellemesi · ${next.revisionProposed??0} revizyon. ${next.ingestProcessed??result.analysisCount} kaynak işlendi ve kilitlendi.`,"success");}catch(e){notify(err(e),"error");}finally{setBusy(false);}
  };
  const toggle=(videoId:string)=>setSelectedVideoIds((current)=>current.includes(videoId)?current.filter((id)=>id!==videoId):[...current,videoId]);
  const selectAll=()=>setSelectedVideoIds(nextSources.map((source)=>source.videoId));

  const counts=result?[
    ["Hikâye",result.universe.stories.length],["Muhatap",result.universe.characters.length],["Olay",result.universe.events.length],["Mekân",result.universe.locations.length],["Nesne",result.universe.objects.length],["Bağlantı",result.universe.relations.length],
  ]:[];
  const inspected=result?resultEntries(result.universe,resultCategory):[];
  const selectedResult=inspected.find((entry)=>entry.key===selectedResultKey)??inspected[0]??null;
  const categoryCount=(category:ResultCategory)=>result?resultEntries(result.universe,category).length:0;

  const statusCopy=failed
    ? `Çalışma #${status.run?.id} başarısız. Kaynaklar henüz kilitlenmedi; çalışmayı iptal edip aynı videoları yeniden deneyebilirsin.`
    : revisions
      ? `Önce 04 · İnceleme → Revizyonlar bölümündeki ${n(revisions)} kararı tamamla.`
      : awaiting
        ? `Çalışma #${awaiting} hazır. Sonuçları kontrol et; onaylarsan incelemeye aktar, istemezsen iptal et.`
        : pending
          ? drafts
            ? `${n(drafts)} taslak kayıt yayına çıkmadan bekliyor; sıradaki en eski kaynaklardan yeni batch hazırlanabilir.`
            : `Sıradaki en eski ${n(Math.min(pending,batchLimit))} kaynak seçim için hazır.`
          : drafts
            ? `${n(drafts)} taslak kayıt gizli durumda bekliyor.`
            : "Yeni ayıklanmış kaynak bekleniyor.";

  return <div className="universe-workbench">
    <section className="panel universe-workspace-status"><div className="universe-workspace-copy"><strong>{n(pending)} yeni kaynak · {n(processed)} işlenmiş kaynak</strong><span>{statusCopy}</span></div><div className="universe-workspace-buttons">{result?.state==="done"&&!applied&&<button className="universe-apply-button" disabled={busy||!complete} onClick={()=>void apply()}>{complete?"İncelemeye aktar":"Eksik sonuç"}</button>}{canCancel&&<button className="universe-cancel-button" disabled={busy} onClick={()=>void cancelPrepared()}>Çalışmayı iptal et</button>}{active?<button className="universe-update-button stop" disabled={busy} onClick={()=>void stop()}>Durdur</button>:!awaiting&&!failed&&<button className="universe-update-button" disabled={!canStart} onClick={()=>void start()}>{pending?`${selectedVideoIds.length} kaynağı işle`:"Yeni kaynak yok"}</button>}</div></section>

    {!active&&!awaiting&&!revisions&&!failed&&!result&&nextSources.length>0&&<section className="panel universe-batch-selection">
      <div className="universe-batch-head"><div><small>KRONOLOJİK ÇALIŞMA PENCERESİ</small><h3>Sıradaki en eski {nextSources.length} kaynak</h3><p>Bir turda en fazla {batchLimit} video işlenir. Daha yeni videolar bu pencere tamamlanmadan öne alınmaz.</p></div><div className="universe-batch-actions"><button onClick={selectAll} disabled={selectedVideoIds.length===nextSources.length}>Tümünü seç</button><button onClick={()=>setSelectedVideoIds([])} disabled={!selectedVideoIds.length}>Seçimi temizle</button></div></div>
      <div className="universe-batch-list">{nextSources.map((source,index)=><label key={source.videoId} className={selectedVideoIds.includes(source.videoId)?"selected":""}><input type="checkbox" checked={selectedVideoIds.includes(source.videoId)} onChange={()=>toggle(source.videoId)}/><span className="universe-batch-index">{String(index+1).padStart(2,"0")}</span><span className="universe-batch-copy"><strong>{source.title||"Başlıksız video"}</strong><small>{source.publishedAt||"Yayın tarihi yok"}</small></span></label>)}</div>
      <div className="universe-batch-foot"><strong>{selectedVideoIds.length} / {nextSources.length} seçildi</strong><span>{pending>nextSources.length?`${n(pending-nextSources.length)} kaynak sonraki kronolojik pencerelerde bekliyor.`:"Bu pencere mevcut bekleyen kaynakların tamamını içeriyor."} Seçilmeyen videolar da sırada kalır.</span></div>
    </section>}

    {active&&<section className="panel universe-empty"><span>EVRENE İŞLEME · #{status.run?.id}</span><h3>{n(status.run?.doneChunks??0)} / {n(status.run?.totalChunks??0)} parça tamamlandı</h3><p>Bu çalışma yalnız {n(status.run?.analysisCount??selectedVideoIds.length)} seçilmiş yeni kaynağı kullanıyor. Durdurursan tamamlanan ara parçalar silinir ve kaynaklar sırada kalır.</p></section>}
    {failed&&<section className="panel universe-run-error"><div><small>SON BAŞARISIZ EVRENE İŞLEME</small><strong>Çalışma #{status.run?.id}</strong><span>{n(status.run?.doneChunks??0)} / {n(status.run?.totalChunks??0)} parça tamamlandı. Kaynaklar henüz işlenmiş olarak kilitlenmedi.</span></div><details><summary>Hata ayrıntısı</summary><pre>{status.run?.error||"Hata ayrıntısı yok."}</pre></details></section>}
    {!active&&!result&&!failed&&nextSources.length===0&&<section className="panel universe-empty"><span>EVRENE İŞLEME</span><h3>{pending?`${n(pending)} kaynak sırada.`:"Yeni kaynak bekleniyor."}</h3><p>02 · Ayıklama'dan geçen kaynaklar en eskiden başlayarak en fazla {batchLimit} videoluk çalışma pencereleriyle ilerler. Evrene aktarılan kaynaklar yalnız “İncelemeye aktar” onayından sonra işlenmiş olarak kilitlenir.</p></section>}

    {result&&<section className={`panel universe-result-panel${result.state==="error"?" error":""}`}>
      <div className="universe-result-head"><div><small>{result.state==="error"?"KISMİ / BAŞARISIZ SONUÇ":"ÜRETİLEN EVREN TASLAĞI"} · #{result.id}</small><strong>{result.analysisCount} kaynak · {result.model}</strong><span>{result.state==="done"?"Henüz 04 · İnceleme alanına aktarılmadı; bu ekranda güvenle kontrol veya iptal edebilirsin.":"Bu çalışma uygulanmadı. İptal ettiğinde kaynaklar yeniden aynı sırada kalır."}</span></div><div className={`universe-result-state ${result.state}`}>{result.state==="done"&&complete?"Hazır":result.state==="error"?"Başarısız":"Eksik"}</div></div>
      <div className="universe-result-metrics">{counts.map(([label,value])=><div key={String(label)}><small>{label}</small><strong>{n(Number(value))}</strong></div>)}</div>
      <div className="universe-result-context"><div><strong>Kaynak kapsamı {result.sourceCoverage?.actual??0} / {result.sourceCoverage?.expected??result.analysisCount}</strong><span>{complete?"Tüm seçili kaynaklar sonuçta korunuyor.":`${result.sourceCoverage?.missing?.length??0} kaynak sonuçta eksik.`}</span></div><details><summary>Kaynak videolar · {result.sources?.length??result.analysisCount}</summary><div className="universe-result-sources">{(result.sources??[]).map((source)=><span key={source.videoId}><b>{source.title||source.videoId}</b><small>{source.publishedAt||source.videoId}</small></span>)}{!result.sources?.length&&<span><b>Kaynak listesi eski çalışma formatında.</b><small>{result.analysisCount} video kullanıldı.</small></span>}</div></details></div>
      <nav className="universe-result-tabs" aria-label="Evrene İşleme sonuç türü">{resultCategories.map((category)=><button key={category.key} className={resultCategory===category.key?"active":""} onClick={()=>{setResultCategory(category.key);setSelectedResultKey(null);}}><span>{category.label}</span><b>{n(categoryCount(category.key))}</b></button>)}</nav>
      <div className="universe-result-layout">
        <div className="universe-result-list">{inspected.map((entry)=><button key={entry.key} className={selectedResult?.key===entry.key?"active":""} onClick={()=>setSelectedResultKey(entry.key)}><small>{entry.label}</small><strong>{entry.title}</strong><span>{entry.sourceVideoIds.length} kaynak</span></button>)}{!inspected.length&&<p>Bu türde sonuç üretilmedi.</p>}</div>
        <article className="universe-result-detail">{selectedResult?<><small>{selectedResult.label.toUpperCase()}</small><h3>{selectedResult.title}</h3><p>{selectedResult.summary||"Bu kayıt için özet üretilmedi."}</p>{selectedResult.details.length>0&&<section><strong>AYRINTILAR</strong><ol>{selectedResult.details.map((detail,index)=><li key={`${detail}:${index}`}>{detail}</li>)}</ol></section>}<section><strong>KAYNAK VİDEOLAR</strong><div className="universe-result-source-ids">{selectedResult.sourceVideoIds.length?selectedResult.sourceVideoIds.map((id)=><code key={id}>{id}</code>):<span>Kaynak etiketi yok.</span>}</div></section></>:<div className="universe-result-detail-empty">Bu türde incelenecek sonuç yok.</div>}</article>
      </div>
    </section>}
  </div>;
}
