import { useState, useEffect } from "react";
import { apiGet } from "../lib/api";

export function AuditScreen() {
  const typeColors: Record<string,string> = {read:"var(--accent)",write:"var(--low-light)",export:"var(--cyan)",admin:"var(--medium-light)",system:"var(--text-3)",search:"var(--purple)"};
  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState<string|null>(null);
  const [activeFilter, setActiveFilter] = useState("All");

  useEffect(() => {
    apiGet<any[]>("/api/audit-log")
      .then(data => {
        const normalised = data.map((entry: any) => ({
          ...entry,
          ts: entry.ts ?? (entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—"),
          user: entry.user ?? entry.userId ?? "System",
          type: (entry.type ?? entry.actionType ?? "system").toLowerCase(),
          action: entry.action ?? entry.description ?? "—",
          resource: entry.resource ?? entry.resourceId ?? "—",
          ip: entry.ip ?? entry.ipAddress ?? "—",
          status: entry.status ?? "OK",
        }));
        setAuditRows(normalised);
        setAuditError(null);
      })
      .catch(err => setAuditError(err.message))
      .finally(() => setAuditLoading(false));
  }, []);

  const filterChips = ["All","Read","Write","Export","Admin","System"];

  // Chip filters by log.type (e.g. "Read" chip -> type === "read"); "All"
  // shows everything.
  const filteredRows = auditRows.filter(log => {
    return activeFilter === "All" || log.type === activeFilter.toLowerCase();
  });

  return (
    <div style={{padding:"26px 28px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
        <div>
          <h1 className="section-head">Audit Logs</h1>
          <p className="page-sub">Complete activity audit trail for compliance, accountability, and security review.</p>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{display:"flex",gap:7,marginBottom:16}}>
        {filterChips.map(f=>(
          <div
            key={f}
            className={`chip ${activeFilter===f?"active":""}`}
            style={{cursor:"pointer"}}
            onClick={()=>setActiveFilter(f)}
          >
            {f}
            <span style={{marginLeft:5,fontSize:10,opacity:0.65}}>
              ({f==="All" ? auditRows.length : auditRows.filter(r=>r.type===f.toLowerCase()).length})
            </span>
          </div>
        ))}
      </div>

      {auditLoading && <p className="page-sub" style={{marginBottom:12}}>Loading audit log…</p>}
      {auditError && <p className="page-sub" style={{marginBottom:12,color:"var(--high-light)"}}>Couldn't reach the API ({auditError}).</p>}
      {!auditLoading && filteredRows.length === 0 && (
        <p className="page-sub" style={{marginBottom:12}}>No audit entries match this filter.</p>
      )}
      <div className="card">
        <table className="data-table">
          <thead>
            <tr><th>Timestamp</th><th>User</th><th>Action Type</th><th>Action</th><th>Resource</th><th>IP / Session</th><th>Status</th></tr>
          </thead>
          <tbody>
            {filteredRows.map((log,i)=>(
              <tr key={i}>
                <td><span className="mono" style={{fontSize:11.5,color:"var(--text-3)"}}>{log.ts}</span></td>
                <td><span style={{color:"var(--text-1)",fontWeight:500}}>{log.user}</span></td>
                <td>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:typeColors[log.type]||"var(--text-4)",flexShrink:0}}/>
                    <span style={{fontSize:11,color:typeColors[log.type]||"var(--text-3)",textTransform:"capitalize"}}>{log.type}</span>
                  </div>
                </td>
                <td><span style={{color:"var(--text-1)"}}>{log.action}</span></td>
                <td><span className="mono" style={{fontSize:11.5,color:"var(--accent-hi)"}}>{log.resource}</span></td>
                <td><span className="mono" style={{fontSize:11,color:"var(--text-4)"}}>{log.ip}</span></td>
                <td><span className="badge badge-verified">{log.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
