const s="together-listener-session";function t(e){localStorage.setItem(s,JSON.stringify(e))}function n(){const e=localStorage.getItem(s);return e?JSON.parse(e):null}export{n as g,t as s};
