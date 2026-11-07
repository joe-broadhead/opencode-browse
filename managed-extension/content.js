(function(){function e(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function t(t){if(!e(t))return;let n=t.state,r=t.owner;if(n!==`attached`&&n!==`running`&&n!==`waiting`||r!==`session`&&r!==`user`)return;let i=t.message,a=t.handoffId;if(n!==`waiting`||typeof i==`string`&&typeof a==`string`)return{state:n,owner:r,...typeof t.sessionId==`string`?{sessionId:t.sessionId}:{},...t.readOnly===!0?{readOnly:!0}:{},...typeof i==`string`?{message:i}:{},...typeof a==`string`?{handoffId:a}:{},...t.recording===!0?{recording:!0}:{}}}var n,r,i,a,o,s;globalThis.__opencodeBrowserPageStatus||(globalThis.__opencodeBrowserPageStatus=!0,chrome.runtime.onMessage.addListener((e,i,a)=>{if(typeof e!=`object`||!e||!(`action`in e))return;if(e.action===`evict-extension-frames`){a({removed:b(document)});return}if(e.action===`page-status.clear`)return C();let o=`status`in e?t(e.status):void 0;e.action===`page-status.set`&&o&&(n=o,r=void 0,o.state===`running`&&b(document),l())}),chrome.runtime.sendMessage({action:`page-status.ready`}).catch(()=>void 0));function c(){return n?.state===`waiting`&&n.handoffId!==void 0&&!n.recording}function l(){if(!n)return;let e=c();if(!e)S();else if(document.documentElement){let e=a??x(),t=e.getElementById(`pill`);t.dataset.state=`waiting`,e.getElementById(`label`).textContent=`Waiting for you`,t.title=[n.owner===`session`?`An agent opened this tab`:`You let agents use this tab`,n.sessionId?`Session ${n.sessionId}`:void 0].filter(Boolean).join(` · `),e.getElementById(`message`).textContent=n.message??`Finish this step, then continue.`,e.getElementById(`origin`).textContent=v();let i=e.getElementById(`continue`);i.disabled=r===n.handoffId,i.textContent=r===n.handoffId?`Continuing…`:`Continue`,y()}(n.state===`running`||e)&&document.documentElement?(s??=new MutationObserver(e=>{if(n){if(n.state===`running`)for(let t of e)for(let e of t.addedNodes)b(e);c()&&(e.some(e=>e.attributeName===`open`&&e.target!==i&&u(e.target)&&d(e.target))?_():e.some(e=>e.target===i||e.target===o||!i?.isConnected||!o?.isConnected)&&y())}}),s.observe(document.documentElement,{childList:!0,subtree:!0,attributeFilter:[`open`]}),i&&s.observe(i,{attributes:!0}),o&&s.observe(o,{attributes:!0})):(s?.disconnect(),s=void 0),p(e)}function u(e){return e instanceof HTMLDialogElement&&e.open}function d(e){if(!(e instanceof Element))return!0;try{if(e.matches(`:modal`))return!0}catch{}let t=e.getBoundingClientRect();return[a?.getElementById(`card`),a?.getElementById(`pill`)].some(e=>{if(!e)return!1;let n=e.getBoundingClientRect();return t.left<n.right&&n.left<t.right&&t.top<n.bottom&&n.top<t.bottom})}var f=!1;function p(e){if(e===f)return;f=e;let t=e?`addEventListener`:`removeEventListener`;document[t](`toggle`,m,!0),document[t](`fullscreenchange`,m,!0)}function m(e){c()&&e.target!==i&&(e.type!==`toggle`||e.newState===`open`&&d(e.target))&&(e.type!==`fullscreenchange`||document.fullscreenElement)&&_()}var h=10,g={second:0,count:0};function _(){if(!i?.isConnected)return y();let e=Math.floor(performance.now()/1e3);if(g.second!==e&&(g={second:e,count:0}),!(++g.count>h)){try{i.matches(`:popover-open`)&&i.hidePopover()}catch{}y()}}function v(){let e=location.origin;return e&&e!==`null`?e:location.protocol===`file:`?location.href:`This page`}function y(){if(i&&document.documentElement){for(let e of i.getAttributeNames())e!==`popover`&&i.removeAttribute(e);if(i.getAttribute(`popover`)!==`manual`&&i.setAttribute(`popover`,`manual`),i.isConnected||document.documentElement.append(i),o){for(let e of o.getAttributeNames())o.removeAttribute(e);o.isConnected||document.documentElement.append(o)}try{i.matches(`:popover-open`)||i.showPopover()}catch{}}}function b(e){let t=`chrome-extension://${chrome.runtime.id}`,n=e=>{let n=e.tagName.toLowerCase();if(n.startsWith(`com-1password-`)||e.hasAttribute(`data-onepassword-extension`)||e.hasAttribute(`data-lastpass-root`)||e.id.startsWith(`bitwarden-`))return!0;if(n!==`iframe`&&n!==`frame`&&n!==`object`&&n!==`embed`)return!1;let r=e.getAttribute(`src`)??e.getAttribute(`data`)??``;return r.startsWith(`chrome-extension://`)&&!r.startsWith(t)},r=0,i=e=>{if(e instanceof Element&&n(e))e.remove(),r++;else{e instanceof Element&&e.shadowRoot&&i(e.shadowRoot);for(let t of Array.from(e.querySelectorAll(`*`)))e.contains(t)&&(n(t)?(t.remove(),r++):t.shadowRoot&&i(t.shadowRoot))}};return(e instanceof Element||e instanceof Document||e instanceof ShadowRoot)&&i(e),r}function x(){return o=document.createElement(`div`),o.attachShadow({mode:`closed`}).innerHTML=`<style>${E}</style><div id="vignette"></div>`,i=document.createElement(`div`),i.setAttribute(`popover`,`manual`),a=i.attachShadow({mode:`closed`}),a.innerHTML=`<style>${T}</style>
    <div id="card" role="dialog" aria-labelledby="title" aria-describedby="message">
      <div id="head"><span id="dot"></span><span id="title">Your turn</span><span id="source">${w}browse</span></div>
      <p id="origin"></p>
      <p id="message"></p>
      <div id="actions"><button id="continue" type="button">Continue</button></div>
    </div>
    <div id="pill" role="status" aria-live="polite">${w}<span id="label"></span><span id="light"></span></div>`,a.getElementById(`continue`).addEventListener(`click`,e=>{if(!e.isTrusted)return;let t=n?.handoffId;t&&r!==t&&(r=t,l(),chrome.runtime.sendMessage({action:`handoff.complete`,handoffId:t}).catch(()=>{r=void 0,l()}))}),i.addEventListener(`toggle`,()=>{c()&&queueMicrotask(y)}),a}function S(){i?.remove(),o?.remove(),o=void 0,i=void 0,a=void 0}function C(){n=void 0,r=void 0,s?.disconnect(),s=void 0,p(!1),S()}var w=`<svg class="mark" viewBox="0 0 16 20" width="9" height="11" aria-hidden="true"><path d="M12 16H4V8h8v8Z" fill="currentColor" opacity=".45"/><path d="M12 4H4v12h8V4Zm4 16H0V0h16v20Z" fill="currentColor"/></svg>`,T=`
  :host { all: initial !important; display: flex !important; flex-direction: column !important;
    align-items: flex-end !important; gap: 10px !important; position: fixed !important; inset: auto 0 0 auto !important;
    width: max-content !important; height: auto !important; max-width: 100vw !important; margin: 0 !important;
    padding: 0 12px 12px !important; border: 0 !important; box-sizing: border-box !important;
    background: transparent !important; overflow: visible !important; z-index: 2147483647 !important;
    pointer-events: none !important; }
  * { box-sizing: border-box; }
  #pill, #card { --bg: #161616; --fg: #ededed; --muted: #a0a0a0; --faint: #707070; --ring: rgba(255,255,255,.09);
    --running: #f5a524; --waiting: #4c8dff; --idle: #7a7a7a; --button: #ededed; --button-fg: #111; --button-hover: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; font-style: normal;
    font-synthesis: none; text-transform: none; text-align: left; -webkit-font-smoothing: antialiased; color: var(--fg); }
  #pill { position: relative; display: inline-flex; align-items: center; gap: 7px; height: 26px;
    padding: 0 10px 0 9px; border-radius: 999px; background: color-mix(in srgb, var(--bg) 92%, transparent);
    box-shadow: 0 0 0 1px var(--ring), 0 6px 16px rgba(0,0,0,.22); backdrop-filter: blur(10px);
    font-size: 12px; font-weight: 500; line-height: 26px; letter-spacing: -.01em; white-space: nowrap; }
  .mark { flex: none; display: block; }
  #pill .mark { color: var(--fg); }
  #label { display: block; }
  #light { flex: none; width: 6px; height: 6px; border-radius: 999px; background: var(--idle); }
  #pill[data-state="waiting"] #light { background: var(--waiting); box-shadow: 0 0 0 3px color-mix(in srgb, var(--waiting) 24%, transparent); }
  #card { position: relative; width: 320px; max-width: calc(100vw - 24px); padding: 12px 12px 12px 14px;
    border-radius: 12px; background: var(--bg); pointer-events: auto; user-select: text;
    box-shadow: 0 0 0 1px var(--ring), 0 18px 44px rgba(0,0,0,.34); animation: enter .22s cubic-bezier(.2,.8,.2,1) both; }
  #head { display: flex; align-items: center; gap: 8px; height: 20px; }
  #dot { flex: none; width: 7px; height: 7px; border-radius: 999px; background: var(--waiting);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--waiting) 24%, transparent); }
  #title { font-size: 13px; font-weight: 600; line-height: 20px; letter-spacing: -.01em; }
  #source { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; color: var(--faint); font-size: 11.5px;
    font-weight: 500; line-height: 20px; }
  #source .mark { width: 7px; height: 9px; }
  #origin { margin: 6px 0 0; color: var(--fg); font-size: 12px; font-weight: 500; line-height: 17px; overflow-wrap: anywhere; }
  #message { margin: 6px 0 12px; color: var(--muted); font-size: 13px; line-height: 19px; overflow-wrap: anywhere; }
  #actions { display: flex; justify-content: flex-end; }
  #continue { all: unset; box-sizing: border-box; cursor: pointer; height: 28px; padding: 0 12px; border-radius: 7px;
    background: var(--button); color: var(--button-fg); font-family: inherit; font-size: 13px; font-weight: 500; line-height: 28px;
    transition: background-color .12s; }
  #continue:hover { background: var(--button-hover); }
  #continue:focus-visible { outline: 2px solid var(--waiting); outline-offset: 2px; }
  #continue:disabled { cursor: default; opacity: .6; }
  @media (prefers-color-scheme: light) {
    #pill, #card { --bg: #ffffff; --fg: #171717; --muted: #5f5f5f; --faint: #8f8f8f; --ring: rgba(0,0,0,.09);
      --running: #d97706; --waiting: #2563eb; --idle: #a3a3a3; --button: #171717; --button-fg: #fff; --button-hover: #000; }
    #pill { box-shadow: 0 0 0 1px var(--ring), 0 6px 16px rgba(0,0,0,.10); }
    #card { box-shadow: 0 0 0 1px var(--ring), 0 18px 44px rgba(0,0,0,.14); }
  }
  @keyframes enter { from { opacity: 0; transform: translateY(6px) scale(.98); } }
  @media (prefers-reduced-motion: reduce) { #light, #card { animation: none !important; } }
`,E=`
  :host { all: initial !important; display: block !important; position: fixed !important; inset: 0 !important;
    margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important;
    z-index: 2147483647 !important; pointer-events: none !important; }
  #vignette { position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 2px rgba(76,141,255,.55), inset 0 0 80px rgba(76,141,255,.10);
    animation: fade .3s ease-out both; }
  @keyframes fade { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { #vignette { animation: none !important; } }
`})();