import { useMemo, useState, useEffect } from 'react';
import { apiGet } from '../lib/api';

const fallbackActors = [
  { id:'ACT-001', alias:'ShadowFox', confidence:84, signals:['Handle reuse','PGP correlation','Behavioral overlap'], candidate:'Candidate Entity A' },
  { id:'ACT-003', alias:'GhostLedger', confidence:79, signals:['Wallet reuse','PGP correlation','Temporal overlap'], candidate:'Candidate Entity B' },
  { id:'ACT-004', alias:'CipherWolf', confidence:74, signals:['PGP correlation','Stylometry','Forum migration'], candidate:'Candidate Entity B' },
  { id:'ACT-006', alias:'NullHarbor', confidence:63, signals:['TLS certificate','Domain correlation'], candidate:'Candidate Entity C' },
];

export function AttributionScreen() {
  const [actors, setActors] = useState<any[]>(fallbackActors);
  const [selected, setSelected] = useState<any>(fallbackActors[0]);
  useEffect(()=>{ apiGet<any[]>('/api/attribution').then(rows=>{ if(rows?.length){ const mapped=rows.map((r:any)=>({id:r.actor?.displayId??r.actorId,alias:r.actor?.alias??'Unknown',confidence:r.confidence,signals:Array.isArray(r.rationale)?r.rationale.map((x:string)=>x.replaceAll('_',' ')):[],candidate:r.candidateLabel})); setActors(mapped); setSelected(mapped[0]); }}).catch(()=>{}); },[]);
  const explain = useMemo(() => selected.signals.map((s,i)=>({label:s, value:[selected.confidence, selected.confidence-8, selected.confidence-17][i]})), [selected]);
  return <div style={{padding:'26px 28px'}}>
    <div style={{marginBottom:22}}><h1 className="section-head">Attribution Analysis</h1><p className="page-sub">Correlate aliases, identifiers, infrastructure, persona and behaviour. All records below are synthetic demonstration data.</p></div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1.35fr',gap:16}}>
      <div className="card" style={{padding:16}}><div className="card-title" style={{marginBottom:12}}>Threat Actors</div>{actors.map(a=><button key={a.id} onClick={()=>setSelected(a)} style={{width:'100%',textAlign:'left',background:a.id===selected.id?'var(--accent-dim)':'transparent',border:'1px solid '+(a.id===selected.id?'rgba(99,102,241,.3)':'var(--border)'),borderRadius:8,padding:12,marginBottom:8,color:'var(--text-1)',cursor:'pointer'}}><div style={{display:'flex',justifyContent:'space-between'}}><span className="mono">{a.id}</span><b>{a.confidence}%</b></div><div style={{fontSize:13,marginTop:5}}>{a.alias}</div><div style={{fontSize:10,color:'var(--text-4)',marginTop:5}}>{a.signals.join(' · ')}</div></button>)}</div>
      <div className="card" style={{padding:20}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'start'}}><div><div className="mono" style={{color:'var(--accent-hi)'}}>{selected.id}</div><h2 style={{fontSize:22,margin:'5px 0'}}>{selected.alias}</h2><div style={{fontSize:11,color:'var(--text-4)'}}>Candidate real-world entity: {selected.candidate}</div></div><div style={{fontSize:28,fontWeight:800}}>{selected.confidence}%</div></div><div style={{marginTop:22}}><div className="card-title">Attribution signals</div>{explain.map(x=><div key={x.label} style={{marginTop:14}}><div style={{display:'flex',justifyContent:'space-between',fontSize:11}}><span>{x.label}</span><span>{x.value}%</span></div><div style={{height:7,background:'var(--border)',borderRadius:5,marginTop:5}}><div style={{height:'100%',width:x.value+'%',background:'var(--accent)',borderRadius:5}}/></div></div>)}</div><div style={{marginTop:24,padding:12,border:'1px solid var(--border)',borderRadius:8,background:'rgba(99,102,241,.05)',fontSize:11,color:'var(--text-3)'}}>Attribution confidence is an analytical correlation measure, not proof of identity. Investigators should review the underlying evidence and alternative explanations.</div></div>
    </div>
  </div>
}
