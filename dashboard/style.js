export const css = `
:root{--bg:#F5F7FA;--surface:#fff;--ink:#0F172A;--soft:#5B6678;--faint:#94A0B2;--line:#E7EBF0;--primary:#0F766E;--psoft:#E4F4F1;--red:#DC2626;--rsoft:#FDECEC;--amber:#B45309;--asoft:#FEF3E0;--green:#15803D;--gsoft:#E3F5E9}
@media (prefers-color-scheme:dark){:root{--bg:#0B1220;--surface:#111A2B;--ink:#E8EEF8;--soft:#9AA8BD;--faint:#667389;--line:#223049;--primary:#2DB5A8;--psoft:#12332F;--red:#F87171;--rsoft:#3A1A1A;--amber:#F5A94A;--asoft:#3A2A10;--green:#4ADE80;--gsoft:#12301E}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,sans-serif;font-size:15px}
button,input,select{font:inherit;color:inherit}
.shell{display:flex;min-height:100vh}.side{width:220px;background:var(--surface);border-right:1px solid var(--line);padding:18px 12px;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:4px}
.brand{display:flex;gap:10px;align-items:center;padding:4px 8px 16px;font-weight:700}.logo{width:32px;height:32px;border-radius:10px;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800}
.nav{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:10px;border:0;background:none;color:var(--soft);cursor:pointer;text-align:left;font-weight:500}
.nav.on{background:var(--psoft);color:var(--primary);font-weight:600}.main{flex:1;min-width:0;padding:20px 24px 80px;max-width:1200px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap}h1{font-size:22px;margin:0}
.live{display:inline-flex;gap:6px;align-items:center;font-size:12.5px;color:var(--soft)}.dot{width:8px;height:8px;border-radius:50%;background:var(--green)}.dot.off{background:var(--faint)}
.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px}.chip{border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:7px 13px;cursor:pointer;color:var(--soft);font-size:13.5px}.chip.on{background:var(--primary);border-color:var(--primary);color:#fff}
.inp{border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:8px 10px;min-width:0}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:16px}.tile{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px}
.tile .l{color:var(--soft);font-size:12.5px}.tile .v{font-size:22px;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums}.tile .s{color:var(--soft);font-size:12px;margin-top:2px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:16px;min-width:0}.card h2{font-size:15px;margin:0 0 10px}
.two{display:grid;gap:16px;grid-template-columns:1fr 1fr}@media(max-width:900px){.two{grid-template-columns:1fr}}
.tbl{width:100%;border-collapse:collapse;font-size:14px}.tbl th{text-align:left;color:var(--soft);font-weight:500;font-size:12.5px;padding:6px 8px;border-bottom:1px solid var(--line)}.tbl td{padding:9px 8px;border-bottom:1px solid var(--line)}
.tbl tr.click{cursor:pointer}.tbl tr.click:hover{background:var(--psoft)}.num{text-align:right;font-variant-numeric:tabular-nums}.scroll{overflow-x:auto}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:var(--psoft);color:var(--primary)}.badge.red{background:var(--rsoft);color:var(--red)}.badge.amber{background:var(--asoft);color:var(--amber)}.badge.gray{background:var(--bg);color:var(--soft)}
.rank{display:grid;grid-template-columns:minmax(80px,1.2fr) 3fr auto;gap:10px;align-items:center;padding:6px 0;font-size:14px}.bar{height:8px;border-radius:4px;background:var(--bg);overflow:hidden}.bar i{display:block;height:100%;background:var(--primary);border-radius:4px}
.btn{border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:8px 14px;cursor:pointer;font-weight:600}.btn.p{background:var(--primary);border-color:var(--primary);color:#fff}.btn.d{color:var(--red)}.btn:disabled{opacity:.5}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9}.sheet{background:var(--surface);border-radius:16px;padding:18px;width:100%;max-width:520px;max-height:90vh;overflow:auto}
.field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}.field span{font-size:12.5px;color:var(--soft)}.empty{color:var(--soft);padding:18px 4px;text-align:center}.err{color:var(--red);font-size:13.5px;margin:6px 0}
.tabs{display:none}@media(max-width:760px){.side{display:none}.main{padding:14px 14px 90px}.tabs{display:flex;position:fixed;bottom:0;left:0;right:0;background:var(--surface);border-top:1px solid var(--line);z-index:5;padding:4px 4px calc(4px + env(safe-area-inset-bottom));overflow-x:auto}.tabs .nav{flex:1;flex-direction:column;gap:2px;font-size:11.5px;padding:8px 10px;min-width:64px;align-items:center}}
.tip{position:absolute;background:var(--ink);color:var(--surface);padding:5px 9px;border-radius:8px;font-size:12.5px;pointer-events:none;white-space:nowrap;transform:translate(-50%,-110%)}
.sub{display:none;font-size:12px;color:var(--soft)}@media(max-width:760px){.hm{display:none}.sub{display:block}.filters .inp[type=date]{flex:1;min-width:130px}}
.login{max-width:380px;margin:12vh auto;padding:0 16px}.login .card{padding:20px}
`;
