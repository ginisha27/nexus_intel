import { useState, useEffect } from "react";
import { riskBg } from "../data";
import { PulseIndicator } from "../components/shared";
import { apiGet, apiPost, apiPatch } from "../lib/api";

const ROLE_LABEL: Record<string,string> = {
  ADMINISTRATOR: "Administrator",
  INVESTIGATOR: "Investigator",
  ANALYST: "Analyst",
};

export function AdminScreen() {
  const roles = ["Administrator","Investigator","Analyst"];
  const perms = ["Search Intelligence","View Evidence","Manage Cases","Generate Reports","Manage Users","View Audit Logs"];
  const matrix: Record<string,boolean[]> = {
    Administrator:[true,true,true,true,true,true],
    Investigator:[true,true,true,true,false,false],
    Analyst:[true,true,false,true,false,false],
  };

  const [users, setUsers] = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string|null>(null);

  const [showAddUser, setShowAddUser] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("INVESTIGATOR");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string|null>(null);

  const [justCreated, setJustCreated] = useState<{email:string; tempPassword:string; action:"created"|"reset"}|null>(null);
  const [resettingId, setResettingId] = useState<string|null>(null);

  const loadUsers = () => {
    setUsersLoading(true);
    apiGet<any[]>("/api/users")
      .then(data => { setUsers(data); setUsersError(null); })
      .catch(err => setUsersError(err.message))
      .finally(() => setUsersLoading(false));
  };

  useEffect(() => { loadUsers(); }, []);

  const submitNewUser = async () => {
    if (!newName.trim() || !newEmail.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { user, tempPassword } = await apiPost<{user:any; tempPassword:string}>("/api/users", {
        name: newName.trim(), email: newEmail.trim(), role: newRole,
      });
      setJustCreated({ email: user.email, tempPassword, action: "created" });
      setNewName(""); setNewEmail(""); setNewRole("INVESTIGATOR");
      setShowAddUser(false);
      loadUsers();
    } catch (err: any) {
      setCreateError(err.message ?? "Failed to create user.");
    } finally {
      setCreating(false);
    }
  };

  const changeRole = async (id: string, role: string) => {
    try {
      await apiPatch(`/api/users/${id}/role`, { role });
      loadUsers();
    } catch {
      // loadUsers() below on next render will reflect actual server state
      // either way; a silent failure here just means the optimistic UI
      // change didn't happen, not that anything's in a bad state.
    }
  };

  // Admin-initiated reset — for a forgotten/locked-out account, as opposed
  // to the self-service change a logged-in user does themselves (see the
  // "Change Password" option under the account menu in Layout.tsx). Same
  // one-time-reveal banner as account creation.
  const resetPassword = async (id: string, email: string) => {
    if (!confirm(`Reset ${email}'s password? Their current password and all active sessions will stop working immediately.`)) return;
    setResettingId(id);
    try {
      const { tempPassword } = await apiPost<{user:any; tempPassword:string}>(`/api/users/${id}/reset-password`, {});
      setJustCreated({ email, tempPassword, action: "reset" });
    } catch (err: any) {
      alert(err.message ?? "Failed to reset password.");
    } finally {
      setResettingId(null);
    }
  };

  const [sources, setSources] = useState<any[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState<string|null>(null);

  useEffect(() => {
    apiGet<any[]>("/api/sources")
      .then(data => { setSources(data); setSourcesError(null); })
      .catch(err => setSourcesError(err.message))
      .finally(() => setSourcesLoading(false));
  }, []);

  return (
    <div style={{padding:"26px 28px"}}>
      <div style={{marginBottom:22}}>
        <h1 className="section-head">Administration</h1>
        <p className="page-sub">User management, access control, permissions, and system status.</p>
      </div>

      {justCreated && (
        <div style={{marginBottom:16,padding:"12px 16px",background:"rgba(22,163,74,0.08)",border:"1px solid rgba(22,163,74,0.25)",borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
          <div style={{fontSize:12,color:"var(--text-2)"}}>
            {justCreated.action === "reset" ? "Reset password for " : "Created "}<strong>{justCreated.email}</strong> — temporary password: <span className="mono" style={{color:"var(--low-light)"}}>{justCreated.tempPassword}</span>
            <div style={{fontSize:10.5,color:"var(--text-4)",marginTop:2}}>Shown once — relay it to them securely. It can't be retrieved again after this.</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={()=>setJustCreated(null)}>Dismiss</button>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        {/* Users — real roster from /api/users */}
        <div className="card" style={{padding:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:600,color:"var(--text-1)"}}>Users</div>
            <button className="btn btn-primary btn-sm" onClick={()=>setShowAddUser(v=>!v)}>+ Add User</button>
          </div>

          {showAddUser && (
            <div style={{padding:"12px 0",marginBottom:6,borderBottom:"1px solid var(--border)"}}>
              <div style={{display:"flex",gap:8,marginBottom:8}}>
                <input className="input" style={{flex:1,padding:"7px 10px",fontSize:12}} placeholder="Full name" value={newName} onChange={e=>setNewName(e.target.value)}/>
                <input className="input" style={{flex:1,padding:"7px 10px",fontSize:12}} placeholder="Email" value={newEmail} onChange={e=>setNewEmail(e.target.value)}/>
              </div>
              <div style={{display:"flex",gap:8}}>
                <select className="input" style={{flex:1,padding:"7px 28px 7px 10px",fontSize:12}} value={newRole} onChange={e=>setNewRole(e.target.value)}>
                  <option value="ADMINISTRATOR">Administrator</option>
                  <option value="INVESTIGATOR">Investigator</option>
                  <option value="ANALYST">Analyst</option>
                </select>
                <button className="btn btn-primary btn-sm" onClick={submitNewUser} disabled={creating}>{creating ? "Creating…" : "Create"}</button>
              </div>
              {createError && <p style={{fontSize:11,color:"var(--high-light)",marginTop:6}}>{createError}</p>}
            </div>
          )}

          {usersLoading && <p className="page-sub" style={{fontSize:12}}>Loading users…</p>}
          {usersError && <p className="page-sub" style={{fontSize:12,color:"var(--high-light)"}}>Couldn't reach the API ({usersError}).</p>}
          {!usersLoading && !usersError && users.map((u,i)=>(
            <div key={u.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid var(--border)"}}>
              <div style={{width:34,height:34,borderRadius:"50%",background:`hsl(${220+i*44},50%,22%)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:`hsl(${220+i*44},70%,65%)`,flexShrink:0}}>
                {u.name[0]}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12.5,color:"var(--text-1)",fontWeight:500}}>{u.name}</div>
                <div style={{fontSize:10.5,color:"var(--text-4)"}}>{u.email}{u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now() ? " · locked" : ""}</div>
              </div>
              <select
                className="input"
                style={{padding:"5px 26px 5px 8px",fontSize:11,width:"auto",flexShrink:0}}
                value={u.role}
                onChange={e=>changeRole(u.id, e.target.value)}
              >
                <option value="ADMINISTRATOR">Administrator</option>
                <option value="INVESTIGATOR">Investigator</option>
                <option value="ANALYST">Analyst</option>
              </select>
              <button
                className="btn btn-ghost btn-sm"
                style={{fontSize:10.5,flexShrink:0}}
                disabled={resettingId===u.id}
                onClick={()=>resetPassword(u.id, u.email)}
              >
                {resettingId===u.id ? "Resetting…" : "Reset Password"}
              </button>
            </div>
          ))}
        </div>

        {/* Permission matrix */}
        <div className="card" style={{padding:20}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--text-1)",marginBottom:16}}>Permission Matrix</div>
          <table className="data-table" style={{fontSize:12}}>
            <thead>
              <tr>
                <th style={{width:160}}>Permission</th>
                {roles.map(r=><th key={r} style={{textAlign:"center"}}>{r}</th>)}
              </tr>
            </thead>
            <tbody>
              {perms.map((p,pi)=>(
                <tr key={p}>
                  <td style={{color:"var(--text-2)"}}>{p}</td>
                  {roles.map(r=>(
                    <td key={r} style={{textAlign:"center"}}>
                      <span style={{color:matrix[r][pi]?"var(--low-light)":"var(--text-4)",fontSize:15}}>{matrix[r][pi]?"✓":"○"}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Data sources — real Source rows, with a real listing count per
            source (there is no "last sync" timestamp in the schema, so
            that field is intentionally omitted rather than fabricated). */}
        <div className="card" style={{padding:20}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--text-1)",marginBottom:14}}>Data Sources</div>
          {sourcesLoading && <p className="page-sub" style={{fontSize:12}}>Loading sources…</p>}
          {sourcesError && <p className="page-sub" style={{fontSize:12,color:"var(--high-light)"}}>Couldn't reach the API ({sourcesError}).</p>}
          {!sourcesLoading && !sourcesError && sources.length === 0 && <p className="page-sub" style={{fontSize:12}}>No sources configured yet.</p>}
          {sources.map((src)=>(
            <div key={src.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:"1px solid var(--border)"}}>
              <div style={{fontSize:12,color:"var(--text-2)"}}>{src.name}</div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:10.5,color:"var(--text-4)"}}>{src._count?.listings ?? 0} listings</span>
                <PulseIndicator color="var(--low)"/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
