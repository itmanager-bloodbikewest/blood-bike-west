// =============================================================================
// BLOOD BIKE WEST — COMMAND CENTRE
// Phone number login + Google Sheets via Apps Script
//
// Environment variables (.env):
//   VITE_APPS_SCRIPT_URL   ← your deployed Apps Script Web App URL
// =============================================================================

import { useState, useEffect, useCallback } from "react";

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL;
const VAPID_KEY       = import.meta.env.VITE_FIREBASE_VAPID_KEY;
const FCM_SENDER_ID   = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID;
const FIREBASE_CONFIG = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

// ─── Push notification helper ─────────────────────────────────────────────────
// Registers the service worker, requests permission, gets FCM token,
// and stores it in the Sheets so Apps Script can send notifications to this device.
async function registerPushNotifications(phone) {
  try {
    if (!("serviceWorker" in navigator) || !("Notification" in window)) return;
    if (Notification.permission === "denied") return;

    // Register service worker
    const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    // Dynamically import Firebase messaging (avoids loading it for non-supporting browsers)
    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const { getMessaging, getToken } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js");

    const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
    const messaging = getMessaging(app);

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg,
    });

    if (token) {
      // Store token in Sheets so Apps Script can target this device
      await api("saveFcmToken", { phone, token });
    }
  } catch (e) {
    console.warn("Push notification setup failed:", e.message);
    // Non-fatal — app works fine without push
  }
}

// ─── API helper ───────────────────────────────────────────────────────────────
async function api(action, payload = {}) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("action", action);
  if (Object.keys(payload).length > 0) {
    url.searchParams.set("data", JSON.stringify(payload));
  }
  const res = await fetch(url.toString(), { method: "GET", redirect: "follow" });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error("Invalid response: " + text.slice(0, 100)); }
}

// ─── Phone normalisation ──────────────────────────────────────────────────────
const normalizePhone = (p) => String(p).replace(/[\s\-\(\)\+]/g, "").trim();

// ─── Session helpers (localStorage) ──────────────────────────────────────────
const SESSION_KEY = "bbw_session";
const SESSION_TTL = 2 * 60 * 60 * 1000; // 2 hours in ms
const saveSession = (data) => localStorage.setItem(SESSION_KEY, JSON.stringify({...data, savedAt: Date.now()}));
const loadSession = () => {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if(!s) return null;
    if(Date.now() - s.savedAt > SESSION_TTL) { localStorage.removeItem(SESSION_KEY); return null; }
    return s;
  } catch { return null; }
};
const clearSession = () => localStorage.removeItem(SESSION_KEY);

// ─── Static data ──────────────────────────────────────────────────────────────


const nowTime = () => new Date().toLocaleTimeString("en-IE",{timeZone:"Europe/Dublin",hour:"2-digit",minute:"2-digit",hour12:false});
const nowDate = () => new Date().toLocaleDateString("en-IE",{timeZone:"Europe/Dublin"}).split("/").reverse().join("-").replace(/(\d{4})-(\d{1,2})-(\d{1,2})/,(_,y,m,d)=>`${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`);
const nowDT   = () => { const d=new Date(); return `${nowDate()} ${nowTime()}`; };

// Format raw Sheets values — Sheets stores dates/times as ISO strings or Date serials
const fmtTime = (v) => {
  if(!v) return "—";
  const s = String(v);
  // Already HH:MM format
  if(/^\d{2}:\d{2}$/.test(s)) return s;
  // ISO datetime — extract time part
  if(s.includes("T")) {
    const d = new Date(s);
    if(!isNaN(d)) return d.toTimeString().slice(0,5);
  }
  // "1899-12-30..." is Sheets' epoch for time-only values
  if(s.startsWith("1899-12-30") || s.startsWith("1899-12-31")) {
    const d = new Date(s);
    if(!isNaN(d)) return d.toTimeString().slice(0,5);
  }
  return s.slice(0,5);
};
const fmtDate = (v) => {
  if(!v) return "—";
  const s = String(v);
  // Already YYYY-MM-DD
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // ISO datetime — extract date part
  if(s.includes("T")) return s.slice(0,10);
  return s.slice(0,10);
};
const fmtDT = (v) => {
  if(!v) return "—";
  const s = String(v);
  if(s.includes("T")) return `${s.slice(0,10)} ${new Date(s).toTimeString().slice(0,5)}`;
  return s;
};

const EMPTY_CALL = {
  timestamp:"", timeOfCall:"", dateOfCallFromHospital:"", controllerName:"",
  transportDate:"", dateCallReceived:"",
  originHospital:"", destinationHospital:"",
  itemsTransported:[], numPackages:"", riders:[], riderDutyStatus:"",
  greenLights:null, meetOtherGroup:[], vehicleUsed:"", riderCalled:"", notes:"",
  contactName:"", contactPhone:"", pickupAddress:"", dropOffAddress:"", scheduledMeetupDate:"", scheduledMeetupTime:"",
  pickupTime:"", meetupTime:"", deliveryTime:"", riderHome:"", completedAt:"",
  overrides:{}, status:"pending-pickup", id:"",
};

// ─── Colours & shared styles ──────────────────────────────────────────────────
const C = {
  bg:"#090910", panel:"#0f0f1a", card:"#13131f", border:"#1e1e30",
  borderHi:"#2a2a42", text:"#e2e2f0", muted:"#636380", accent:"#2060ff",
  green:"#22c55e", orange:"#f59e0b", red:"#ef4444", white:"#fff", purple:"#a855f7",
};
const inp = (hi=false,ro=false) => ({
  width:"100%", boxSizing:"border-box",
  background:hi?"#2060ff0f":C.card,
  border:`1px solid ${hi?"#2060ff55":C.borderHi}`,
  color:ro?C.muted:C.text, padding:"9px 12px", borderRadius:7,
  fontSize:13, fontFamily:"'IBM Plex Sans',sans-serif",
  outline:"none", cursor:ro?"default":"text",
});
const sel = {...inp(), appearance:"none", cursor:"pointer"};
const Label = ({children,auto,optional,note}) => (
  <div style={{display:"flex",alignItems:"baseline",gap:6,marginBottom:5}}>
    <span style={{fontSize:9,letterSpacing:2,color:C.muted,fontFamily:"'IBM Plex Mono',monospace",textTransform:"uppercase"}}>{children}</span>
    {auto     && <span style={{fontSize:8,background:"#2060ff22",color:"#6090ff",borderRadius:3,padding:"1px 5px",letterSpacing:1}}>AUTO</span>}
    {optional && <span style={{fontSize:8,background:"#f59e0b22",color:"#f59e0b",borderRadius:3,padding:"1px 5px",letterSpacing:1}}>OPTIONAL</span>}
    {note     && <span style={{fontSize:8,color:C.muted,fontStyle:"italic"}}>{note}</span>}
  </div>
);
const Section = ({title,children,style={}}) => (
  <div style={{background:C.card,border:`1px solid ${C.borderHi}`,borderRadius:10,padding:"18px 20px",marginBottom:16,...style}}>
    <div style={{fontSize:9,letterSpacing:3,color:C.muted,fontFamily:"'IBM Plex Mono',monospace",marginBottom:14}}>{title}</div>
    {children}
  </div>
);
const Grid = ({cols=2,children,gap=14}) => (
  <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap}}>{children}</div>
);
const Chip = ({active,children,onClick,color}) => {
  const ac=color||(active?C.accent:"#2a2a42");
  return <button onClick={onClick} style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${active?ac:C.borderHi}`,background:active?ac+"22":C.card,color:active?ac:C.muted,fontSize:11,cursor:"pointer",fontFamily:"'IBM Plex Sans',sans-serif",whiteSpace:"nowrap"}}>{children}</button>;
};
const AutoTime = ({label,value,fieldKey,overrides,onOverride,note}) => {
  const ov=!!overrides[fieldKey];
  return (
    <div>
      <Label auto note={note}>{label}</Label>
      <div style={{display:"flex",gap:6}}>
        <input type="time" value={value} readOnly={!ov} onChange={e=>ov&&onOverride(fieldKey,e.target.value)}
          style={{...inp(ov,!ov),flex:1,color:value?C.text:"#333"}}/>
        <button onClick={()=>onOverride(fieldKey,ov?null:(value||nowTime()))}
          style={{background:ov?"#2060ff22":C.card,border:`1px solid ${ov?"#2060ff":C.borderHi}`,color:ov?"#6090ff":C.muted,borderRadius:6,padding:"0 10px",cursor:"pointer",fontSize:10,whiteSpace:"nowrap"}}>
          {ov?"✎ on":"✎"}
        </button>
      </div>
    </div>
  );
};
const STATUS = {
  "pending-pickup":{label:"Pending Pickup",color:C.orange},
  "in-transit":    {label:"In Transit",    color:C.accent},
  "delivered":     {label:"Delivered",     color:C.green},
  "complete":      {label:"Transport Complete",color:C.purple},
};
const Badge = ({s}) => {
  const m=STATUS[s]||{label:s,color:C.muted};
  return <span style={{fontSize:9,color:m.color,background:m.color+"22",padding:"2px 8px",borderRadius:10,letterSpacing:1,fontFamily:"'IBM Plex Mono',monospace"}}>● {m.label.toUpperCase()}</span>;
};
const DB_COLS = [
  {key:"id",label:"Run ID"},{key:"timestamp",label:"Timestamp"},
  {key:"dateOfCallFromHospital",label:"Date of Call"},
  {key:"controllerName",label:"Controller"},
  {key:"originHospital",label:"Origin"},{key:"destinationHospital",label:"Destination"},
  {key:"riders",label:"Rider(s)",fmt:v=>Array.isArray(v)?v.join(", "):v},
  {key:"vehicleUsed",label:"Vehicle"},
  {key:"itemsTransported",label:"Items",fmt:v=>Array.isArray(v)?v.join(", "):v},
  {key:"numPackages",label:"Pkgs"},
  {key:"greenLights",label:"Green Lights",fmt:v=>v===true?"Yes":v===false?"No":"—"},
  {key:"riderCalled",label:"Rider Called"},{key:"pickupTime",label:"Pickup"},
  {key:"meetupTime",label:"Meet-up"},{key:"deliveryTime",label:"Delivery"},
  {key:"riderHome",label:"Rider Home"},{key:"completedAt",label:"Completed At"},
  {key:"contactName",label:"Contact"},{key:"contactPhone",label:"Phone"},
  {key:"notes",label:"Notes"},
];
const SheetTable = ({rows,emptyMsg}) => (
  <div style={{overflowX:"auto"}}>
    {rows.length===0
      ? <div style={{textAlign:"center",padding:"48px 0",color:C.muted,fontFamily:"'IBM Plex Mono',monospace",fontSize:11,letterSpacing:2}}>{emptyMsg}</div>
      : <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,fontFamily:"'IBM Plex Sans',sans-serif"}}>
          <thead><tr style={{background:"#0f0f1a",borderBottom:`2px solid ${C.borderHi}`}}>
            {DB_COLS.map(col=><th key={col.key} style={{padding:"8px 12px",textAlign:"left",fontSize:9,letterSpacing:2,color:C.muted,fontFamily:"'IBM Plex Mono',monospace",whiteSpace:"nowrap",fontWeight:600}}>{col.label.toUpperCase()}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((row,i)=>(
              <tr key={row.id} style={{background:i%2===0?C.card:"#111120",borderBottom:`1px solid ${C.border}`}}>
                {DB_COLS.map(col=>{
                  const raw=row[col.key];
                  const val=col.fmt?col.fmt(raw??[]):raw||"—";
                  const isId=col.key==="id";
                  return <td key={col.key} style={{padding:"8px 12px",whiteSpace:col.key==="notes"?"normal":"nowrap",color:isId?"#6090ff":C.text,fontFamily:isId?"'IBM Plex Mono',monospace":"inherit",fontSize:isId?11:12,maxWidth:col.key==="notes"?240:undefined}}>{val}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
    }
  </div>
);

// =============================================================================
// LOCATION FIELD — dropdown + "Add new" with fuzzy match suggestions
// =============================================================================
function LocationField({ label, value, onChange, options, exclude=[], onAdd }) {
  const [adding, setAdding] = useState(false);
  const [query,  setQuery]  = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [confirmVal, setConfirmVal] = useState(null);

  useEffect(()=>{
    if(!query.trim()){ setSuggestions([]); return; }
    const q = query.toLowerCase();
    const matches = options.filter(o=>o.toLowerCase().includes(q) && !exclude.includes(o));
    setSuggestions(matches);
  },[query, options, exclude]);

  const handleAdd = () => {
    const v = query.trim(); if(!v) return;
    const exact = options.find(o=>o.toLowerCase()===v.toLowerCase());
    if(exact){ onChange(exact); setAdding(false); setQuery(""); return; }
    setConfirmVal(v);
  };

  const confirmAdd = () => {
    onAdd(confirmVal);
    onChange(confirmVal);
    setAdding(false); setQuery(""); setConfirmVal(null);
  };

  return (
    <div>
      <Label>{label}</Label>
      {!adding ? (
        <div style={{display:"flex",gap:6}}>
          <select value={value} onChange={e=>onChange(e.target.value)} style={{...sel,flex:1,width:"auto"}}>
            <option value="">— Select —</option>
            {options.filter(o=>!exclude.includes(o)).map(h=><option key={h}>{h}</option>)}
          </select>
          <button onClick={()=>setAdding(true)}
            style={{background:C.card,border:`1px solid ${C.borderHi}`,color:C.muted,borderRadius:6,padding:"0 12px",fontSize:11,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",whiteSpace:"nowrap"}}>
            + ADD
          </button>
        </div>
      ) : (
        <div>
          {confirmVal ? (
            <div style={{background:"#14281a",border:`1px solid ${C.green}`,borderRadius:7,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
              <span style={{fontSize:13}}>Add <strong>"{confirmVal}"</strong> to the list?</span>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button onClick={confirmAdd} style={{background:C.green,color:"#000",border:"none",borderRadius:5,padding:"5px 12px",fontSize:11,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700}}>CONFIRM</button>
                <button onClick={()=>setConfirmVal(null)} style={{background:"none",border:`1px solid ${C.borderHi}`,color:C.muted,borderRadius:5,padding:"5px 8px",fontSize:11,cursor:"pointer"}}>✕</button>
              </div>
            </div>
          ) : (
            <div style={{position:"relative"}}>
              <div style={{display:"flex",gap:6}}>
                <input value={query} onChange={e=>setQuery(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&handleAdd()}
                  placeholder="Type location name…"
                  autoFocus
                  style={{...inp(),flex:1,width:"auto"}}/>
                <button onClick={handleAdd}
                  style={{background:C.accent,border:"none",color:C.white,borderRadius:6,padding:"0 12px",fontSize:11,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace"}}>ADD</button>
                <button onClick={()=>{setAdding(false);setQuery("");setSuggestions([]);}}
                  style={{background:"none",border:`1px solid ${C.borderHi}`,color:C.muted,borderRadius:6,padding:"0 10px",fontSize:11,cursor:"pointer"}}>✕</button>
              </div>
              {suggestions.length>0&&(
                <div style={{position:"absolute",top:"100%",left:0,right:80,background:"#1a1a28",border:`1px solid ${C.borderHi}`,borderRadius:6,zIndex:50,marginTop:4}}>
                  <div style={{padding:"6px 14px",fontSize:10,color:C.muted,letterSpacing:1}}>SIMILAR EXISTING OPTIONS:</div>
                  {suggestions.map(s=>(
                    <div key={s} onClick={()=>{onChange(s);setAdding(false);setQuery("");setSuggestions([]);}}
                      style={{padding:"9px 14px",cursor:"pointer",fontSize:13,borderBottom:`1px solid ${C.border}`}}
                      onMouseEnter={e=>e.currentTarget.style.background="#2a2a40"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>{s}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// RIDER DETAIL — extracted as proper component to allow useState hooks
// =============================================================================
function RiderDetail({ call:c, onBack, onPickup, onDropoff, onRiderHome, onNote }) {
  const [riderNote, setRiderNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);

  const canPickup  = c.status==="pending-pickup";
  const canDropoff = c.status==="in-transit";
  const canHome    = c.status==="delivered";

  const InfoRow = ({label,value}) => value ? (
    <div style={{padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
      <div style={{fontSize:9,color:C.muted,letterSpacing:2,fontFamily:"'IBM Plex Mono',monospace",marginBottom:4}}>{label.toUpperCase()}</div>
      <div style={{fontSize:14,color:C.text,fontWeight:500}}>{value}</div>
    </div>
  ) : null;

  const TimeRow = ({label,val}) => (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
      <span style={{fontSize:11,color:C.muted,fontFamily:"'IBM Plex Mono',monospace",letterSpacing:1}}>{label.toUpperCase()}</span>
      <span style={{fontSize:13,fontWeight:600,fontFamily:"'IBM Plex Mono',monospace",color:val?C.green:"#2a2a40"}}>{val?fmtTime(val):"—"}</span>
    </div>
  );

  const saveNote = () => {
    if(!riderNote.trim()) return;
    onNote(riderNote.trim());
    setRiderNote(""); setNoteSaved(true); setTimeout(()=>setNoteSaved(false),2000);
  };

  return (
    <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column"}}>
      <div style={{background:C.panel,borderBottom:`1px solid ${C.border}`,padding:"14px 24px",flexShrink:0}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:C.muted,fontSize:12,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",padding:0,marginBottom:6}}>← BACK</button>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:16,color:"#6090ff",fontWeight:700}}>{c.id}</div>
            <div style={{marginTop:4}}><Badge s={c.status}/></div>
          </div>
          {c.greenLights===true&&(
            <div style={{background:"#22c55e11",border:"1px solid #22c55e44",borderRadius:8,padding:"8px 14px"}}>
              <span style={{color:C.green,fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:700,letterSpacing:2}}>🟢 GREEN LIGHTS AUTH.</span>
            </div>
          )}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:24}}>
        <div style={{marginBottom:24,display:"flex",flexDirection:"column",gap:12}}>
          {canPickup&&<button onClick={onPickup} style={{background:C.accent,border:"none",color:C.white,padding:"20px",borderRadius:12,fontSize:17,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,letterSpacing:2,boxShadow:"0 0 30px #2060ff55"}}>⬆  PICKED UP</button>}
          {canDropoff&&<button onClick={onDropoff} style={{background:C.green,border:"none",color:"#000",padding:"20px",borderRadius:12,fontSize:17,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,letterSpacing:2,boxShadow:"0 0 30px #22c55e55"}}>✓  DROPPED OFF</button>}
          {(canHome||c.riderHome)&&<button onClick={canHome?onRiderHome:undefined} disabled={!!c.riderHome} style={{background:c.riderHome?"#1a1a28":C.orange,border:`1px solid ${c.riderHome?C.borderHi:"none"}`,color:c.riderHome?C.muted:"#000",padding:"20px",borderRadius:12,fontSize:17,cursor:c.riderHome?"default":"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,letterSpacing:2,boxShadow:c.riderHome?"none":"0 0 30px #f59e0b55"}}>🏠  RIDER HOME{c.riderHome?` — ${fmtTime(c.riderHome)}`:""}</button>}          {c.status==="delivered"&&<div style={{background:"#1a1a28",border:`1px solid ${C.borderHi}`,borderRadius:12,padding:"14px",textAlign:"center",color:C.muted,fontFamily:"'IBM Plex Mono',monospace",fontSize:12,letterSpacing:2}}>Waiting for controller to mark complete</div>}
        </div>
        <Section title="Run Details">
          <InfoRow label="Origin" value={c.originHospital}/>
          <InfoRow label="Destination" value={c.destinationHospital}/>
          <InfoRow label="Items Transported" value={Array.isArray(c.itemsTransported)?c.itemsTransported.join(", "):c.itemsTransported||null}/>
          <InfoRow label="Pick-up Address" value={c.pickupAddress||null}/>
          <InfoRow label="Drop-off Address" value={c.dropOffAddress||null}/>
          <InfoRow label="Vehicle" value={c.vehicleUsed||null}/>
        </Section>
        {((Array.isArray(c.meetOtherGroup)?c.meetOtherGroup.length>0:c.meetOtherGroup)||c.scheduledMeetupTime)&&(
          <Section title="Meet-up">
            <InfoRow label="Meet with" value={Array.isArray(c.meetOtherGroup)?c.meetOtherGroup.join(", ")||null:c.meetOtherGroup||null}/>
            <InfoRow label="Scheduled Meet-up Time" value={c.scheduledMeetupTime||null}/>
          </Section>
        )}
        {(c.contactName||c.contactPhone)&&(
          <Section title="Contact">
            <InfoRow label="Contact Name" value={c.contactName||null}/>
            <InfoRow label="Contact Phone" value={c.contactPhone?<a href={`tel:${c.contactPhone}`} style={{color:"#6090ff",textDecoration:"none"}}>{c.contactPhone}</a>:null}/>
          </Section>
        )}
        <Section title="Timing">
          <TimeRow label="Rider Called" val={c.riderCalled}/>
          <TimeRow label="Picked Up"    val={c.pickupTime}/>
          <TimeRow label="Delivered"    val={c.deliveryTime}/>
          <TimeRow label="Rider Home"   val={c.riderHome}/>
        </Section>
        {c.notes&&<Section title="Dispatcher Notes"><div style={{fontSize:13,color:"#c7c7d0",lineHeight:1.8,whiteSpace:"pre-line"}}>{c.notes}</div></Section>}
        <Section title="Add Note">
          <Label optional>Visible to controller</Label>
          <textarea value={riderNote} onChange={e=>setRiderNote(e.target.value)} rows={3}
            placeholder="Add a note for this run…"
            style={{...inp(),width:"100%",boxSizing:"border-box",resize:"vertical",lineHeight:1.7}}/>
          <div style={{display:"flex",gap:8,marginTop:10,alignItems:"center"}}>
            <button onClick={saveNote} style={{background:C.accent,border:"none",color:C.white,padding:"8px 18px",borderRadius:6,fontSize:11,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700}}>SAVE NOTE</button>
            {noteSaved&&<span style={{fontSize:11,color:C.green,fontFamily:"'IBM Plex Mono',monospace"}}>✓ Saved</span>}
          </div>
        </Section>
      </div>
    </div>
  );
}

// =============================================================================
// LOGIN SCREEN
// =============================================================================
function LoginScreen({ onLogin }) {
  const [phone,   setPhone]   = useState("");
  const [errMsg,  setErrMsg]  = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const normalized = normalizePhone(phone);
    if (!normalized) { setErrMsg("Please enter your phone number."); return; }
    setLoading(true); setErrMsg("");
    try {
      const res = await api("getUserRole", { phone: normalized });
      if (!res.found) {
        setErrMsg("Phone number not recognised. Please contact your administrator.");
        setLoading(false); return;
      }
      const session = { phone: normalized, role: res.role, name: res.name, controllers: res.controllers||[], riders: res.riders||[] };
      saveSession(session);
      onLogin(session);
      // Register for push notifications after login (non-blocking)
      registerPushNotifications(normalized).catch(()=>{});
    } catch(e) {
      setErrMsg("Could not connect to server. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'IBM Plex Sans',sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <div style={{textAlign:"center",marginBottom:40}}>
        <img src="/logo.png" alt="Blood Bike West" style={{width:80,marginBottom:8}}/>
        <div style={{fontSize:20,fontWeight:700,letterSpacing:2,fontFamily:"'IBM Plex Mono',monospace",color:C.white}}>BLOOD BIKE WEST</div>
        <div style={{fontSize:10,color:C.muted,letterSpacing:4,marginTop:2}}>COMMAND CENTRE</div>
      </div>
      <div style={{background:C.card,border:`1px solid ${C.borderHi}`,borderRadius:12,padding:32,width:"100%",maxWidth:380}}>
        <div style={{fontSize:13,color:C.muted,marginBottom:24,lineHeight:1.7,textAlign:"center"}}>
          Enter your phone number to sign in.
        </div>
        {errMsg&&<div style={{background:"#2a1010",border:`1px solid ${C.red}`,borderRadius:7,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#ff8080"}}>{errMsg}</div>}
        <Label>Phone Number</Label>
        <input type="tel" value={phone} onChange={e=>setPhone(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&handleLogin()}
          placeholder="e.g. 087 123 4567"
          style={{...inp(),width:"100%",marginBottom:14,fontSize:15}}/>
        <button onClick={handleLogin} disabled={loading}
          style={{width:"100%",background:loading?"#1a2a4a":C.accent,border:"none",color:C.white,padding:"13px",borderRadius:8,fontSize:13,cursor:loading?"default":"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,letterSpacing:1}}>
          {loading?"CHECKING…":"SIGN IN"}
        </button>
      </div>
      <div style={{marginTop:20,fontSize:11,color:"#333",textAlign:"center"}}>
        Not registered? Contact your Blood Bike West administrator.
      </div>
      {/* iOS PWA install hint */}
      {/iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone && (
        <div style={{marginTop:20,background:"#1a1a28",border:`1px solid ${C.borderHi}`,borderRadius:10,padding:"14px 18px",maxWidth:380,width:"100%",textAlign:"center"}}>
          <div style={{fontSize:12,color:C.muted,lineHeight:1.7}}>
            📲 <strong style={{color:C.text}}>Enable notifications on iPhone:</strong><br/>
            Tap <strong style={{color:C.text}}>Share</strong> → <strong style={{color:C.text}}>Add to Home Screen</strong><br/>
            Then open the app from your home screen.
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN APP
// =============================================================================
function MainApp({ session, onLogout }) {
  const { role, name, controllers, riders } = session;
  const [dash, setDash]         = useState(role==="rider"?"rider":"dispatcher");
  const [view, setView]         = useState(role==="rider"?"rider-list":"log");
  const [pendingDB, setPendingDB]     = useState([]);
  const [completedDB, setCompletedDB] = useState([]);
  const [form, setForm]         = useState({...EMPTY_CALL});
  const [hospitals,    setHospitals]    = useState([]);
  const [vehicles,     setVehicles]     = useState([]);
  const [meetups,      setMeetups]      = useState([]);
  const [itemPicklist, setItems]        = useState([]);
  const [dutyStatuses, setDutyStatuses] = useState([]);
  const [itemQuery, setItemQ]   = useState("");
  const [itemSugg,  setItemSugg] = useState([]);
  const [confirmItem, setCI]    = useState(null);
  const [detailId,  setDetailId] = useState(null);
  const [toast,     setToast]   = useState(null);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);

  const notify = (msg,color=C.green) => { setToast({msg,color}); setTimeout(()=>setToast(null),3000); };
  const allCalls = [...pendingDB,...completedDB];
  const selectedCall = allCalls.find(c=>c.id===detailId)||null;

  // Load picklists
  useEffect(()=>{
    api("getLists").then(res=>{
      if(res.hospitals)    setHospitals(res.hospitals);
      if(res.items)        setItems(res.items);
      if(res.meetups)      setMeetups(res.meetups);
      if(res.vehicles)     setVehicles(res.vehicles);
      if(res.dutyStatuses) setDutyStatuses(res.dutyStatuses);
    }).catch(()=>{});
  },[]);

  // Load calls
  const loadCalls = useCallback(async()=>{
    setDbLoading(true);
    try {
      const [pending,completed] = await Promise.all([api("getPendingCalls"),api("getCompletedCalls")]);
      setPendingDB(pending.rows||[]);
      setCompletedDB(completed.rows||[]);
    } catch(e){ notify("Could not load calls",C.red); }
    setDbLoading(false);
  },[]);

  useEffect(()=>{ loadCalls(); },[loadCalls]);
  useEffect(()=>{ const t=setInterval(loadCalls,30000); return ()=>clearInterval(t); },[loadCalls]);

  const patchCall = async(id,patch)=>{
    setPendingDB(prev=>prev.map(c=>c.id===id?{...c,...patch}:c));
    setCompletedDB(prev=>prev.map(c=>c.id===id?{...c,...patch}:c));
    try { await api("updateCall",{id,...patch}); }
    catch(e){ notify("Sync error — saved locally",C.orange); }
  };
  const patchField = (id,k,v) => patchCall(id,{[k]:v});

  const initiateNewCall = () => {
    const td=nowDate();
    setForm({...EMPTY_CALL,timestamp:nowDT(),riderCalled:nowTime(),transportDate:td,dateCallReceived:td,dateOfCallFromHospital:td,controllerName:name,meetOtherGroup:[],overrides:{}});
    setItemQ(""); setItemSugg([]); setCI(null);
    setView("newcall");
  };

  const fset = (k,v) => setForm(f=>({...f,[k]:v}));
  const ftog = (k,v) => setForm(f=>({...f,[k]:f[k].includes(v)?f[k].filter(x=>x!==v):[...f[k],v]}));
  const handleOverride = (fk,val) => {
    setForm(f=>{
      const ov={...f.overrides};
      if(val===null){delete ov[fk];return {...f,overrides:ov};}
      return {...f,[fk]:val,overrides:{...ov,[fk]:true}};
    });
  };
  useEffect(()=>{ if(!form.overrides?.dateCallReceived) setForm(f=>({...f,dateCallReceived:f.transportDate})); },[form.transportDate]);
  useEffect(()=>{
    if(!itemQuery.trim()){setItemSugg([]);return;}
    const q=itemQuery.toLowerCase();
    setItemSugg(itemPicklist.filter(i=>i.toLowerCase().includes(q)&&!form.itemsTransported.includes(i)));
    setCI(null);
  },[itemQuery,itemPicklist,form.itemsTransported]);

  const addItem = () => {
    const v=itemQuery.trim(); if(!v) return;
    const match=itemPicklist.find(i=>i.toLowerCase()===v.toLowerCase());
    if(match){if(!form.itemsTransported.includes(match))ftog("itemsTransported",match);setItemQ("");}
    else setCI(v);
  };
  const confirmAdd = () => {
    setItems(p=>[...p,confirmItem]);
    setForm(f=>({...f,itemsTransported:[...f.itemsTransported,confirmItem]}));
    setItemQ(""); setCI(null);
    notify(`"${confirmItem}" added to picklist`);
  };

  const REQUIRED = ["controllerName","originHospital","destinationHospital","riders","vehicleUsed"];
  const submitCall = async() => {
    const missing=REQUIRED.filter(k=>!form[k]||(Array.isArray(form[k])&&!form[k].length));
    if(missing.length){notify("Please complete all required fields",C.red);return;}
    const id=`RUN-${String(pendingDB.length+completedDB.length+1).padStart(4,"0")}`;
    const record={...form,id,status:"pending-pickup"};
    setPendingDB(prev=>[record,...prev]);
    setDetailId(id); setView("detail");
    notify(`${id} logged`);
    try { await api("addCall",{record}); }
    catch(e){ notify("Logged locally — sync error",C.orange); }
  };

  const triggerPickup    = id => { patchCall(id,{pickupTime:nowTime(),status:"in-transit"}); notify("Pickup recorded",C.accent); };
  const triggerDropoff   = id => { patchCall(id,{meetupTime:nowTime(),deliveryTime:nowTime(),status:"delivered"}); notify("Delivery recorded ✓"); };
  const triggerRiderHome = id => { patchCall(id,{riderHome:nowTime()}); notify("Rider home recorded"); };

  const markComplete = async(id) => {
    const call=pendingDB.find(c=>c.id===id); if(!call) return;
    const completedAt=nowDT();
    setPendingDB(prev=>prev.filter(c=>c.id!==id));
    setCompletedDB(prev=>[{...call,status:"complete",completedAt},...prev]);
    setConfirmComplete(false); setView("log");
    notify(`${id} → Completed`,C.purple);
    try { await api("completeCall",{id,completedAt}); }
    catch(e){ notify("Complete saved locally — sync error",C.orange); }
  };

  const isDispatcher = dash==="dispatcher";
  const NavBtn = ({v,children}) => (
    <button onClick={()=>setView(v)}
      style={{background:view===v?"#2060ff22":"none",border:"none",borderBottom:`2px solid ${view===v?"#2060ff":"transparent"}`,color:view===v?"#6090ff":C.muted,padding:"14px 18px",fontSize:11,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:1,whiteSpace:"nowrap"}}>
      {children}
    </button>
  );

  return (
    <div style={{fontFamily:"'IBM Plex Sans',sans-serif",background:C.bg,minHeight:"100vh",color:C.text,display:"flex",flexDirection:"column"}}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>

      {toast&&<div style={{position:"fixed",top:16,right:16,background:toast.color,color:"#fff",padding:"10px 20px",borderRadius:7,fontSize:13,zIndex:9999,boxShadow:"0 4px 24px #0009",fontFamily:"'IBM Plex Mono',monospace"}}>{toast.msg}</div>}

      {/* Header */}
      <div style={{background:C.panel,borderBottom:`1px solid ${C.border}`,padding:"0 24px",height:56,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10}}><img src="/logo.png" alt="" style={{width:32,height:32,objectFit:"contain"}}/><div style={{fontSize:14,fontWeight:700,letterSpacing:2,fontFamily:"'IBM Plex Mono',monospace",color:C.white}}>BLOOD BIKE WEST</div></div>
          <div style={{fontSize:8,color:C.muted,letterSpacing:4}}>COMMAND CENTRE</div>
        </div>
        {isDispatcher
          ? <button onClick={initiateNewCall} style={{background:C.accent,border:"none",color:C.white,padding:"9px 28px",borderRadius:7,fontSize:12,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,letterSpacing:1}}>+ NEW CALL</button>
          : <div/>
        }
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {role==="controller"&&(
            <div style={{display:"flex",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:3,gap:3}}>
              {[["dispatcher","CONTROLLER"],["rider","RIDER"]].map(([d,label])=>(
                <button key={d} onClick={()=>{setDash(d);setView(d==="dispatcher"?"log":"rider-list");}}
                  style={{background:dash===d?"#2060ff":"transparent",color:dash===d?C.white:C.muted,border:"none",borderRadius:6,padding:"6px 14px",fontSize:11,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:1,fontWeight:600}}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,color:C.text}}>{name}</div>
            <button onClick={()=>{clearSession();onLogout();}} style={{background:"none",border:"none",color:C.muted,fontSize:10,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",padding:0,letterSpacing:1}}>SIGN OUT</button>
          </div>
        </div>
      </div>

      {/* Dispatcher sub-nav */}
      {isDispatcher&&view!=="newcall"&&view!=="detail"&&(
        <div style={{background:C.panel,borderBottom:`1px solid ${C.border}`,display:"flex",paddingLeft:8,flexShrink:0}}>
          <NavBtn v="log">RUN LOG</NavBtn>
          {dbLoading&&<div style={{marginLeft:"auto",padding:"14px 18px",fontSize:10,color:C.muted,fontFamily:"'IBM Plex Mono',monospace"}}>⟳ syncing…</div>}
        </div>
      )}

      {/* ── RUN LOG ── */}
      {isDispatcher&&view==="log"&&(
        <div style={{flex:1,padding:24,overflowY:"auto"}}>
          {pendingDB.length===0&&completedDB.length===0?(
            <div style={{textAlign:"center",paddingTop:80}}>
              <div style={{fontSize:48,marginBottom:12}}>📋</div>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,letterSpacing:2,color:"#333"}}>NO RUNS LOGGED TODAY</div>
              <div style={{fontSize:12,color:"#333",marginTop:6}}>Press <strong style={{color:C.accent}}>+ NEW CALL</strong> to begin</div>
            </div>
          ):(
            <>
              {pendingDB.length>0&&(
                <>
                  <div style={{fontSize:9,letterSpacing:3,color:C.orange,fontFamily:"'IBM Plex Mono',monospace",marginBottom:10}}>ACTIVE — {pendingDB.length} RUN{pendingDB.length!==1?"S":""}</div>
                  {pendingDB.map(c=>(
                    <div key={c.id} onClick={()=>{setDetailId(c.id);setView("detail");}}
                      style={{background:C.card,border:`1px solid ${C.borderHi}`,borderRadius:10,padding:"13px 18px",marginBottom:8,cursor:"pointer",display:"grid",gridTemplateColumns:"110px 1fr 1fr 1fr auto",gap:14,alignItems:"center"}}
                      onMouseEnter={e=>e.currentTarget.style.borderColor="#2a2a60"}
                      onMouseLeave={e=>e.currentTarget.style.borderColor=C.borderHi}>
                      <div><div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,color:"#6090ff",marginBottom:2}}>{c.id}</div><div style={{fontSize:10,color:C.muted}}>{c.timestamp?.slice(11)||"—"}</div></div>
                      <div><div style={{fontSize:13,fontWeight:600,marginBottom:1}}>{c.originHospital}</div><div style={{fontSize:11,color:C.muted}}>→ {c.destinationHospital}</div></div>
                      <div style={{fontSize:12,color:C.muted}}>{Array.isArray(c.itemsTransported)?c.itemsTransported.join(", "):c.itemsTransported||"—"}</div>
                      <div style={{fontSize:12}}>{Array.isArray(c.riders)?c.riders.join(", "):c.riders||"—"}</div>
                      <Badge s={c.status}/>
                    </div>
                  ))}
                </>
              )}
              {completedDB.length>0&&(
                <>
                  <div style={{fontSize:9,letterSpacing:3,color:C.purple,fontFamily:"'IBM Plex Mono',monospace",marginBottom:10,marginTop:24}}>COMPLETED — {completedDB.length} RUN{completedDB.length!==1?"S":""}</div>
                  {completedDB.map(c=>(
                    <div key={c.id} onClick={()=>{setDetailId(c.id);setView("detail");}}
                      style={{background:"#111120",border:`1px solid ${C.border}`,borderRadius:10,padding:"13px 18px",marginBottom:8,cursor:"pointer",display:"grid",gridTemplateColumns:"110px 1fr 1fr 1fr auto",gap:14,alignItems:"center",opacity:0.7}}
                      onMouseEnter={e=>{e.currentTarget.style.opacity="1";e.currentTarget.style.borderColor="#3a2a5a";}}
                      onMouseLeave={e=>{e.currentTarget.style.opacity="0.7";e.currentTarget.style.borderColor=C.border;}}>
                      <div><div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,color:C.purple,marginBottom:2}}>{c.id}</div><div style={{fontSize:10,color:C.muted}}>{c.completedAt?.slice(11)||"—"}</div></div>
                      <div><div style={{fontSize:13,fontWeight:600,marginBottom:1}}>{c.originHospital}</div><div style={{fontSize:11,color:C.muted}}>→ {c.destinationHospital}</div></div>
                      <div style={{fontSize:12,color:C.muted}}>{Array.isArray(c.itemsTransported)?c.itemsTransported.join(", "):c.itemsTransported||"—"}</div>
                      <div style={{fontSize:12}}>{Array.isArray(c.riders)?c.riders.join(", "):c.riders||"—"}</div>
                      <Badge s={c.status}/>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── DB VIEWS ── */}
      {isDispatcher&&view==="db-pending"&&(
        <div style={{flex:1,overflowY:"auto",padding:24}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <div><div style={{fontSize:9,letterSpacing:3,color:C.orange,fontFamily:"'IBM Plex Mono',monospace",marginBottom:4}}>DATABASE — SHEET 1</div><div style={{fontSize:18,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace"}}>📋 Pending Calls</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>Live records for calls in transit.</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:28,fontWeight:700,color:C.orange,fontFamily:"'IBM Plex Mono',monospace"}}>{pendingDB.length}</div><div style={{fontSize:10,color:C.muted,letterSpacing:1}}>ACTIVE</div></div>
          </div>
          <div style={{background:C.card,border:`1px solid ${C.borderHi}`,borderRadius:10,overflow:"hidden"}}><SheetTable rows={pendingDB} emptyMsg="NO PENDING CALLS"/></div>
        </div>
      )}
      {isDispatcher&&view==="db-complete"&&(
        <div style={{flex:1,overflowY:"auto",padding:24}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <div><div style={{fontSize:9,letterSpacing:3,color:C.purple,fontFamily:"'IBM Plex Mono',monospace",marginBottom:4}}>DATABASE — SHEET 2</div><div style={{fontSize:18,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace"}}>✓ Completed Calls</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>Archived on Mark Complete.</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:28,fontWeight:700,color:C.purple,fontFamily:"'IBM Plex Mono',monospace"}}>{completedDB.length}</div><div style={{fontSize:10,color:C.muted,letterSpacing:1}}>COMPLETED</div></div>
          </div>
          <div style={{background:C.card,border:`1px solid ${C.borderHi}`,borderRadius:10,overflow:"hidden"}}><SheetTable rows={completedDB} emptyMsg="NO COMPLETED CALLS YET"/></div>
        </div>
      )}

      {/* ── NEW CALL FORM ── */}
      {isDispatcher&&view==="newcall"&&(
        <div style={{flex:1,overflowY:"auto",padding:24,maxWidth:920,margin:"0 auto",width:"100%"}}>
          {confirmItem&&(
            <div style={{background:"#14281a",border:`1px solid ${C.green}`,borderRadius:8,padding:"12px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:13}}>Add <strong>"{confirmItem}"</strong> to the picklist?</span>
              <div style={{display:"flex",gap:8}}>
                <button onClick={confirmAdd} style={{background:C.green,color:"#000",border:"none",borderRadius:5,padding:"6px 16px",fontSize:11,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700}}>CONFIRM & ADD</button>
                <button onClick={()=>setCI(null)} style={{background:"none",border:`1px solid ${C.borderHi}`,color:C.muted,borderRadius:5,padding:"6px 12px",fontSize:11,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace"}}>CANCEL</button>
              </div>
            </div>
          )}
          <div style={{fontSize:10,color:C.muted,fontFamily:"'IBM Plex Mono',monospace",letterSpacing:2,marginBottom:18}}>NEW CALL — * REQUIRED FIELDS</div>

          <Section title="Call Metadata">
            <Grid cols={3}>
              <div><Label auto>Timestamp</Label><input value={form.timestamp} readOnly style={{...inp(false,true),width:"100%"}}/></div>
              <div><Label>Time of Call from Hospital *</Label><input type="time" value={form.timeOfCall} onChange={e=>fset("timeOfCall",e.target.value)} style={{...inp(),width:"100%"}}/></div>
              <div><Label note="defaults to today">Date of Call from Hospital</Label><input type="date" value={form.dateOfCallFromHospital} onChange={e=>fset("dateOfCallFromHospital",e.target.value)} style={{...inp(),width:"100%"}}/></div>
              <div><Label>Controller Name *</Label>
                <select value={form.controllerName} onChange={e=>fset("controllerName",e.target.value)} style={{...sel,width:"100%"}}>
                  <option value="">— Select —</option>
                  {controllers.map(c=><option key={c.name||c}>{c.name||c}</option>)}
                </select>
              </div>
              <div><Label>Transport Date *</Label><input type="date" value={form.transportDate} onChange={e=>fset("transportDate",e.target.value)} style={{...inp(),width:"100%"}}/></div>
              <div>
                <Label auto note="syncs to transport date — click to edit">Date Call Received</Label>
                <input type="date" value={form.dateCallReceived}
                  onChange={e=>fset("dateCallReceived",e.target.value)}
                  style={{...inp(),width:"100%",cursor:"text"}}/>
              </div>
            </Grid>
          </Section>

          <Section title="Route">
            <Grid cols={2}>
              <LocationField
                label="Origin *"
                value={form.originHospital}
                onChange={v=>fset("originHospital",v)}
                options={hospitals}
                exclude={[form.destinationHospital]}
                onAdd={v=>{ setHospitals(p=>[...p,v].sort()); api("addToList",{sheet:"OriginDestination",value:v}).catch(()=>{}); notify(`"${v}" added to Origins`); }}
              />
              <LocationField
                label="Destination *"
                value={form.destinationHospital}
                onChange={v=>fset("destinationHospital",v)}
                options={hospitals}
                exclude={[form.originHospital]}
                onAdd={v=>{ setHospitals(p=>[...p,v].sort()); api("addToList",{sheet:"OriginDestination",value:v}).catch(()=>{}); notify(`"${v}" added to Destinations`); }}
              />
            </Grid>
          </Section>

          <Section title="Items Transported">
            <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:14}}>
              {itemPicklist.map(item=><Chip key={item} active={form.itemsTransported.includes(item)} onClick={()=>ftog("itemsTransported",item)}>{form.itemsTransported.includes(item)?"✓ ":""}{item}</Chip>)}
            </div>
            <div style={{position:"relative"}}>
              <Label optional note="type to search or add new">Custom Item</Label>
              <div style={{display:"flex",gap:6}}>
                <input value={itemQuery} onChange={e=>setItemQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addItem()} placeholder="Type item name…" style={{...inp(),flex:1,width:"auto"}}/>
                <button onClick={addItem} style={{background:C.card,border:`1px solid ${C.borderHi}`,color:C.muted,borderRadius:6,padding:"0 14px",fontSize:11,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace"}}>ADD</button>
              </div>
              {itemSugg.length>0&&(
                <div style={{position:"absolute",top:"100%",left:0,right:70,background:"#1a1a28",border:`1px solid ${C.borderHi}`,borderRadius:6,zIndex:50,marginTop:4}}>
                  {itemSugg.map(s=><div key={s} onClick={()=>{ftog("itemsTransported",s);setItemQ("");}} style={{padding:"9px 14px",cursor:"pointer",fontSize:13,borderBottom:`1px solid ${C.border}`}} onMouseEnter={e=>e.currentTarget.style.background="#2a2a40"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>{s}</div>)}
                </div>
              )}
            </div>
            {form.itemsTransported.length>0&&<div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:6}}>{form.itemsTransported.map(i=><span key={i} style={{background:"#2060ff22",color:"#6090ff",border:"1px solid #2060ff44",borderRadius:12,padding:"3px 10px",fontSize:11}}>{i} <span onClick={()=>ftog("itemsTransported",i)} style={{cursor:"pointer",marginLeft:4,color:C.red}}>×</span></span>)}</div>}
            <div style={{marginTop:14}}><Label>Number of Packages</Label><input type="number" min="0" value={form.numPackages} onChange={e=>fset("numPackages",e.target.value)} placeholder="0" style={{...inp(),width:120}}/></div>
          </Section>

          <Section title="Crew & Vehicle">
            <Grid cols={2} gap={16}>
              <div>
                <Label>Rider *</Label>
                <select value={form.riders[0]||""} onChange={e=>fset("riders",e.target.value?[e.target.value]:[])} style={{...sel,width:"100%"}}>
                  <option value="">— Select Rider —</option>
                  {riders.map(r=><option key={r.name||r}>{r.name||r}</option>)}
                </select>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div><Label>Rider Duty Status</Label><select value={form.riderDutyStatus} onChange={e=>fset("riderDutyStatus",e.target.value)} style={{...sel,width:"100%"}}><option value="">— Select —</option>{dutyStatuses.map(s=><option key={s}>{s}</option>)}</select></div>
                <div><Label>Vehicle Used *</Label><select value={form.vehicleUsed} onChange={e=>fset("vehicleUsed",e.target.value)} style={{...sel,width:"100%"}}><option value="">— Select Vehicle —</option>{vehicles.map(v=><option key={v}>{v}</option>)}</select></div>
                <div>
                  <Label>Meet with Other Group</Label>
                  <div style={{display:"flex",flexWrap:"wrap",gap:7,marginTop:4}}>
                    {meetups.map(g=>{
                      const active=Array.isArray(form.meetOtherGroup)&&form.meetOtherGroup.includes(g);
                      return <Chip key={g} active={active} onClick={()=>{
                        const cur=Array.isArray(form.meetOtherGroup)?form.meetOtherGroup:[];
                        fset("meetOtherGroup",active?cur.filter(x=>x!==g):[...cur,g]);
                      }}>{active?"✓ ":""}{g}</Chip>;
                    })}
                  </div>
                </div>
                <div><Label optional>Scheduled Meet-up Date</Label><input type="date" value={form.scheduledMeetupDate||nowDate()} onChange={e=>fset("scheduledMeetupDate",e.target.value)} style={{...inp(),width:"100%"}}/></div>
                <div><Label optional>Scheduled Meet-up Time</Label><input type="time" value={form.scheduledMeetupTime} onChange={e=>fset("scheduledMeetupTime",e.target.value)} style={{...inp(),width:"100%"}}/></div>              </div>
            </Grid>
          </Section>

          <Section title="Authorisation">
            <Label>Green Lights Authorised *</Label>
            <div style={{display:"flex",gap:10,marginTop:4}}>
              {[true,false].map(val=><button key={String(val)} onClick={()=>fset("greenLights",val)} style={{padding:"8px 24px",borderRadius:7,border:`1px solid ${form.greenLights===val?(val?C.green:C.red):C.borderHi}`,background:form.greenLights===val?(val?"#22c55e22":"#ef444422"):C.card,color:form.greenLights===val?(val?C.green:C.red):C.muted,fontSize:12,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700}}>{val?"✓  YES":"✕  NO"}</button>)}
            </div>
          </Section>

          <Section title="Optional Details">
            <Grid cols={2} gap={14}>
              <div><Label optional>Contact Name</Label><input value={form.contactName} onChange={e=>fset("contactName",e.target.value)} placeholder="Name of contact" style={{...inp(),width:"100%"}}/></div>
              <div><Label optional>Contact Phone Number</Label><input type="tel" value={form.contactPhone} onChange={e=>fset("contactPhone",e.target.value)} placeholder="+353…" style={{...inp(),width:"100%"}}/></div>
              <div><Label optional>Pick-up Address</Label><input value={form.pickupAddress} onChange={e=>fset("pickupAddress",e.target.value)} placeholder="Street address / dept" style={{...inp(),width:"100%"}}/></div>
              <div><Label optional>Drop-off Address</Label><input value={form.dropOffAddress} onChange={e=>fset("dropOffAddress",e.target.value)} placeholder="Street address / dept" style={{...inp(),width:"100%"}}/></div>
            </Grid>
          </Section>

          <Section title="Timing — Auto-Captured (Override Available)">
            <Grid cols={3}>
              <AutoTime label="Rider Called" value={form.riderCalled} fieldKey="riderCalled" overrides={form.overrides} onOverride={handleOverride} note="auto on New Call"/>
              <AutoTime label="Pickup Time" value={form.pickupTime} fieldKey="pickupTime" overrides={form.overrides} onOverride={handleOverride} note="auto on Picked Up"/>
              <AutoTime label="Meet-up Time (actual)" value={form.meetupTime} fieldKey="meetupTime" overrides={form.overrides} onOverride={handleOverride} note="auto on Dropped Off"/>
              <AutoTime label="Delivery Time" value={form.deliveryTime} fieldKey="deliveryTime" overrides={form.overrides} onOverride={handleOverride} note="auto on Dropped Off"/>
              <AutoTime label="Rider Home" value={form.riderHome} fieldKey="riderHome" overrides={form.overrides} onOverride={handleOverride} note="auto on Rider Home"/>
            </Grid>
          </Section>

          <Section title="Other Details / Notes">
            <textarea value={form.notes} onChange={e=>fset("notes",e.target.value)} rows={3} placeholder="Additional details, special instructions, observations…" style={{...inp(),width:"100%",boxSizing:"border-box",resize:"vertical",lineHeight:1.7}}/>
          </Section>

          <div style={{display:"flex",gap:10,marginBottom:40}}>
            <button onClick={submitCall} style={{flex:1,background:C.accent,border:"none",color:C.white,padding:"14px",borderRadius:8,fontSize:13,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,letterSpacing:1}}>LOG CALL & OPEN RUN</button>
            <button onClick={()=>setView("log")} style={{background:"none",border:`1px solid ${C.borderHi}`,color:C.muted,padding:"14px 22px",borderRadius:8,fontSize:12,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace"}}>CANCEL</button>
          </div>
        </div>
      )}

      {/* ── DISPATCHER DETAIL ── */}
      {isDispatcher&&view==="detail"&&selectedCall&&(()=>{
        const c=selectedCall;
        const isCompleted=c.status==="complete";
        const EditRow=({label,fieldKey,type="text",children,readOnly:ro=false,fmt})=>{
          const [editing,setEditing]=useState(false);
          const [val,setVal]=useState(c[fieldKey]||"");
          useEffect(()=>setVal(c[fieldKey]||""),[c[fieldKey]]);
          const save=()=>{patchField(c.id,fieldKey,val);setEditing(false);notify("Saved","#2060ff");};
          if(children||ro) return <div style={{display:"flex",gap:12,padding:"9px 0",borderBottom:`1px solid ${C.border}`,alignItems:"center"}}><div style={{width:200,fontSize:10,color:C.muted,letterSpacing:1,fontFamily:"'IBM Plex Mono',monospace",flexShrink:0}}>{label.toUpperCase()}</div><div style={{fontSize:13,color:C.text,flex:1}}>{children||(fmt?fmt(c[fieldKey]):c[fieldKey])||"—"}</div></div>;
          return <div style={{display:"flex",gap:12,padding:"9px 0",borderBottom:`1px solid ${C.border}`,alignItems:"center"}}>
            <div style={{width:200,fontSize:10,color:C.muted,letterSpacing:1,fontFamily:"'IBM Plex Mono',monospace",flexShrink:0}}>{label.toUpperCase()}</div>
            {editing
              ?<div style={{display:"flex",gap:6,flex:1}}><input type={type} value={type==="date"?fmtDate(val):type==="time"?fmtTime(val):val} onChange={e=>setVal(e.target.value)} autoFocus style={{...inp(true),flex:1,width:"auto"}} onKeyDown={e=>{if(e.key==="Enter")save();if(e.key==="Escape")setEditing(false);}}/><button onClick={save} style={{background:C.green,color:"#000",border:"none",borderRadius:5,padding:"0 12px",cursor:"pointer",fontSize:11,fontFamily:"'IBM Plex Mono',monospace"}}>SAVE</button><button onClick={()=>setEditing(false)} style={{background:"none",border:`1px solid ${C.borderHi}`,color:C.muted,borderRadius:5,padding:"0 10px",cursor:"pointer",fontSize:11}}>✕</button></div>
              :<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"space-between"}}><span style={{fontSize:13,color:val?C.text:C.muted}}>{fmt?fmt(val):val||"—"}</span>{!isCompleted&&<button onClick={()=>setEditing(true)} style={{background:"none",border:`1px solid ${C.borderHi}`,color:C.muted,borderRadius:5,padding:"3px 10px",cursor:"pointer",fontSize:10,fontFamily:"'IBM Plex Mono',monospace"}}>✎ edit</button>}</div>}
          </div>;
        };
        const TimingRow=({label,fieldKey,note})=>{
          const val=allCalls.find(x=>x.id===c.id)?.[fieldKey]||"";
          const [ov,setOv]=useState(false);
          const [ovVal,setOvVal]=useState(val);
          useEffect(()=>setOvVal(val),[val]);
          const saveOv=()=>{patchField(c.id,fieldKey,ovVal);setOv(false);notify("Override saved","#2060ff");};
          return <div style={{display:"flex",gap:12,padding:"9px 0",borderBottom:`1px solid ${C.border}`,alignItems:"center"}}>
            <div style={{width:200,fontSize:10,color:C.muted,letterSpacing:1,fontFamily:"'IBM Plex Mono',monospace",flexShrink:0}}>{label.toUpperCase()}</div>
            {ov?<div style={{display:"flex",gap:6,flex:1}}><input type="time" value={ovVal} onChange={e=>setOvVal(e.target.value)} autoFocus style={{...inp(true),width:120}}/><button onClick={saveOv} style={{background:C.green,color:"#000",border:"none",borderRadius:5,padding:"0 12px",cursor:"pointer",fontSize:11,fontFamily:"'IBM Plex Mono',monospace"}}>SAVE</button><button onClick={()=>setOv(false)} style={{background:"none",border:`1px solid ${C.borderHi}`,color:C.muted,borderRadius:5,padding:"0 10px",cursor:"pointer",fontSize:11}}>✕</button></div>
            :<div style={{display:"flex",alignItems:"center",gap:10,flex:1}}><span style={{fontSize:14,fontWeight:600,fontFamily:"'IBM Plex Mono',monospace",color:val?C.text:"#2a2a40"}}>{val?fmtTime(val):"pending…"}</span>{val&&<span style={{fontSize:9,color:C.green,background:C.green+"22",padding:"1px 6px",borderRadius:8}}>RECORDED</span>}{note&&!val&&<span style={{fontSize:9,color:C.muted,fontStyle:"italic"}}>{note}</span>}{!isCompleted&&<button onClick={()=>setOv(true)} style={{marginLeft:"auto",background:"none",border:`1px solid ${C.borderHi}`,color:C.muted,borderRadius:5,padding:"3px 10px",cursor:"pointer",fontSize:10,fontFamily:"'IBM Plex Mono',monospace"}}>✎ override</button>}</div>}
          </div>;
        };
        return (
          <div style={{flex:1,overflowY:"auto",padding:24,maxWidth:900,margin:"0 auto",width:"100%"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
              <div><button onClick={()=>setView("log")} style={{background:"none",border:"none",color:C.muted,fontSize:12,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",padding:0,marginBottom:6}}>← BACK TO LOG</button><div style={{fontSize:22,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",color:isCompleted?C.purple:"#6090ff"}}>{c.id}</div><div style={{marginTop:6}}><Badge s={c.status}/></div>{isCompleted&&<div style={{fontSize:11,color:C.muted,marginTop:4}}>Completed {c.completedAt}</div>}</div>
              {!isCompleted&&(!confirmComplete
                ?<button onClick={()=>setConfirmComplete(true)} style={{background:C.purple,border:"none",color:C.white,padding:"10px 20px",borderRadius:8,fontSize:12,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,letterSpacing:1,boxShadow:`0 0 20px ${C.purple}44`}}>✓ MARK TRANSPORT COMPLETE</button>
                :<div style={{background:"#1a1028",border:`1px solid ${C.purple}`,borderRadius:10,padding:"14px 18px",textAlign:"center",minWidth:260}}><div style={{fontSize:12,color:C.text,marginBottom:10,fontFamily:"'IBM Plex Mono',monospace"}}>Move to Completed Calls?</div><div style={{fontSize:11,color:C.muted,marginBottom:14}}>This will archive the record.</div><div style={{display:"flex",gap:8}}><button onClick={()=>markComplete(c.id)} style={{flex:1,background:C.purple,border:"none",color:C.white,padding:"8px",borderRadius:6,fontSize:12,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700}}>CONFIRM</button><button onClick={()=>setConfirmComplete(false)} style={{flex:1,background:"none",border:`1px solid ${C.borderHi}`,color:C.muted,padding:"8px",borderRadius:6,fontSize:12,cursor:"pointer",fontFamily:"'IBM Plex Mono',monospace"}}>CANCEL</button></div></div>
              )}
            </div>
            <Section title="Call Metadata">
              <EditRow label="Timestamp" readOnly><span>{fmtDT(c.timestamp)}</span></EditRow>
              <EditRow label="Time of Call" fieldKey="timeOfCall" type="time" fmt={fmtTime}/>
              <EditRow label="Date of Call from Hospital" fieldKey="dateOfCallFromHospital" type="date" fmt={fmtDate}/>
              <EditRow label="Controller" fieldKey="controllerName"/>
              <EditRow label="Transport Date" fieldKey="transportDate" type="date" fmt={fmtDate}/>
              <EditRow label="Date Call Received" fieldKey="dateCallReceived" type="date" fmt={fmtDate}/>
              <EditRow label="Rider Called" readOnly><span style={{fontFamily:"'IBM Plex Mono',monospace"}}>{fmtTime(c.riderCalled)}</span></EditRow>
            </Section>
            <Section title="Route">
              <EditRow label="Origin Hospital" readOnly><span>{c.originHospital}</span></EditRow>
              <EditRow label="Destination Hospital" readOnly><span>{c.destinationHospital}</span></EditRow>
              <EditRow label="Items" readOnly><span>{Array.isArray(c.itemsTransported)?c.itemsTransported.join(", "):c.itemsTransported||"—"}</span></EditRow>
              <EditRow label="No. of Packages" fieldKey="numPackages" type="number"/>
              <EditRow label="Pick-up Address" fieldKey="pickupAddress"/>
              <EditRow label="Drop-off Address" fieldKey="dropOffAddress"/>
            </Section>
            <Section title="Contact">
              <EditRow label="Contact Name" fieldKey="contactName"/>
              <EditRow label="Contact Phone" fieldKey="contactPhone" type="tel"/>
            </Section>
            <Section title="Crew & Vehicle">
              <EditRow label="Rider(s)" readOnly><span>{Array.isArray(c.riders)?c.riders.join(", "):c.riders||"—"}</span></EditRow>
              <EditRow label="Duty Status" readOnly><span>{c.riderDutyStatus||"—"}</span></EditRow>
              <EditRow label="Vehicle" readOnly><span>{c.vehicleUsed||"—"}</span></EditRow>
              <EditRow label="Meet Other Group" readOnly><span>{Array.isArray(c.meetOtherGroup)?c.meetOtherGroup.join(", ")||"—":c.meetOtherGroup||"—"}</span></EditRow>
              <EditRow label="Scheduled Meet-up Date" fieldKey="scheduledMeetupDate" type="date" fmt={fmtDate}/>
              <EditRow label="Scheduled Meet-up Time" fieldKey="scheduledMeetupTime" type="time" fmt={fmtTime}/>
              <EditRow label="Green Lights" readOnly><span style={{color:c.greenLights===true?C.green:c.greenLights===false?C.red:C.muted}}>{c.greenLights===true?"✓ YES":c.greenLights===false?"✕ NO":"—"}</span></EditRow>
            </Section>
            <Section title="Timing Log">
              <TimingRow label="Rider Called"      fieldKey="riderCalled"/>
              <TimingRow label="Pickup Time"       fieldKey="pickupTime"          note="triggers on rider Picked Up"/>
              <EditRow label="Scheduled Meet-up" fieldKey="scheduledMeetupTime" type="time" fmt={fmtTime}/>
              <TimingRow label="Actual Meet-up"    fieldKey="meetupTime"          note="triggers on rider Dropped Off"/>
              <TimingRow label="Delivery Time"     fieldKey="deliveryTime"        note="triggers on rider Dropped Off"/>
              <TimingRow label="Rider Home"        fieldKey="riderHome"           note="triggers on rider Rider Home"/>
              {isCompleted&&<TimingRow label="Completed At" fieldKey="completedAt"/>}
            </Section>
            {c.notes&&<Section title="Notes"><div style={{fontSize:13,color:"#c7c7d0",lineHeight:1.8}}>{c.notes}</div></Section>}
          </div>
        );
      })()}

{/* ── RIDER LIST ── */}
      {!isDispatcher&&view==="rider-list"&&(()=>{
        const isMyRun=c=>{
          const assigned=Array.isArray(c.riders)?c.riders:typeof c.riders==="string"?[c.riders]:[];
          return assigned.length===0||assigned.some(r=>r.trim()===name.trim());
        };
        const myActive=pendingDB.filter(isMyRun);
        const myCompleted=completedDB.filter(isMyRun);
        const RunCard=({c,color})=>(
          <div key={c.id} onClick={()=>{setDetailId(c.id);setView("rider-detail");}}
            style={{background:c.status==="complete"?"#111120":C.card,border:`1px solid ${c.status==="complete"?C.border:C.borderHi}`,borderRadius:10,padding:"13px 18px",marginBottom:8,cursor:"pointer",display:"grid",gridTemplateColumns:"110px 1fr 1fr auto",gap:14,alignItems:"center",opacity:c.status==="complete"?0.7:1}}
            onMouseEnter={e=>{e.currentTarget.style.opacity="1";e.currentTarget.style.borderColor="#2a2a60";}}
            onMouseLeave={e=>{e.currentTarget.style.opacity=c.status==="complete"?"0.7":"1";e.currentTarget.style.borderColor=c.status==="complete"?C.border:C.borderHi;}}>
            <div><div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,color:color||"#6090ff",marginBottom:2}}>{c.id}</div><div style={{fontSize:10,color:C.muted}}>{(c.status==="complete"?c.completedAt:c.timestamp)?.slice(11,16)||"—"}</div></div>
            <div><div style={{fontSize:13,fontWeight:600,marginBottom:1}}>{c.originHospital}</div><div style={{fontSize:11,color:C.muted}}>→ {c.destinationHospital}</div></div>
            <div style={{fontSize:12,color:C.muted}}>{Array.isArray(c.itemsTransported)?c.itemsTransported.join(", "):c.itemsTransported||"—"}</div>
            <Badge s={c.status}/>
          </div>
        );
        return (
          <div style={{flex:1,padding:24,overflowY:"auto"}}>
            {myActive.length===0&&myCompleted.length===0?(
              <div style={{textAlign:"center",paddingTop:80}}>
                <div style={{fontSize:48,marginBottom:10}}>🏍</div>
                <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,letterSpacing:2,color:"#333"}}>NO ACTIVE RUNS</div>
              </div>
            ):(
              <>
                {myActive.length>0&&(
                  <>
                    <div style={{fontSize:9,letterSpacing:3,color:C.orange,fontFamily:"'IBM Plex Mono',monospace",marginBottom:10}}>ACTIVE — {myActive.length} RUN{myActive.length!==1?"S":""}</div>
                    {myActive.map(c=><RunCard key={c.id} c={c} color="#6090ff"/>)}
                  </>
                )}
                {myCompleted.length>0&&(
                  <>
                    <div style={{fontSize:9,letterSpacing:3,color:C.purple,fontFamily:"'IBM Plex Mono',monospace",marginBottom:10,marginTop:24}}>COMPLETED — {myCompleted.length} RUN{myCompleted.length!==1?"S":""}</div>
                    {myCompleted.map(c=><RunCard key={c.id} c={c} color={C.purple}/>)}
                  </>
                )}
              </>
            )}
          </div>
        );
      })()}
      {/* ── RIDER DETAIL ── */}
      {!isDispatcher&&view==="rider-detail"&&selectedCall&&(
        <RiderDetail
          call={selectedCall}
          onBack={()=>setView("rider-list")}
          onPickup={()=>triggerPickup(selectedCall.id)}
          onDropoff={()=>triggerDropoff(selectedCall.id)}
          onRiderHome={()=>triggerRiderHome(selectedCall.id)}
          onNote={(note)=>{
            const updated=(selectedCall.notes?selectedCall.notes+"\n\n":"")+`[Rider ${nowTime()}]: `+note;
            patchCall(selectedCall.id,{notes:updated});
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// ROOT
// =============================================================================
export default function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(()=>{
    const saved = loadSession();
    if(saved) {
      setSession(saved);
      // Re-register push on session restore (token may have rotated)
      registerPushNotifications(saved.phone).catch(()=>{});
    }
    setChecking(false);
  },[]);

  if(checking) return (
    <div style={{background:"#090910",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'IBM Plex Mono',monospace",color:"#636380",fontSize:12,letterSpacing:2}}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&display=swap" rel="stylesheet"/>
      LOADING…
    </div>
  );

  if(!session) return <LoginScreen onLogin={setSession}/>;
  return <MainApp session={session} onLogout={()=>setSession(null)}/>;
}
