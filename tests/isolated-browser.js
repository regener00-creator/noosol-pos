// Deterministic, network-isolated setup for UI tests. A test can never write
// real Supabase data; wait for auth bootstrap before installing fixture state.
async function installIsolatedBrowser(page){
  await page.addInitScript(()=>{
    if(window.top!==window) return;
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:async()=>({}),getRegistrations:async()=>[]}});
  });
  await page.route('https://**/*',route=>{
    const body=route.request().url().includes('/@supabase/')?`(()=>{
      const q=new Proxy({}, {get(_t,k){return k==='then'?(resolve=>resolve({data:[],error:null})):(()=>q);}});
      window.supabase={createClient:()=>new Proxy({auth:{getSession:async()=>{window.testAuthStarted=true;return {data:{session:null}};},onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}},{get:(t,k)=>k in t?t[k]:(()=>q)})};
    })();`:'';
    return route.fulfill({contentType:'text/javascript',body});
  });
  page.setDefaultTimeout(15000);
}
async function waitForIsolatedBootstrap(page){
  await page.waitForFunction(()=>!!window.peposBootstrapReady);
  await page.evaluate(()=>window.peposBootstrapReady);
}
module.exports={installIsolatedBrowser,waitForIsolatedBootstrap};
