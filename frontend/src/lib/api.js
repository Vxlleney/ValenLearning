// Toutes les requetes restent sur l'origine du serveur, aussi sur le reseau local.
export const requestJson = async (route, {body, method, timeout=20000, signal}={}) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  let timedOut = false;
  const timer = setTimeout(() => { timedOut=true; controller.abort(); },timeout);
  try {
    const response = await fetch(route,{method:method || (body ? 'POST' : 'GET'),cache:'no-store',signal:controller.signal,
      ...(body ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {}),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(data?.error || `Le serveur a refusé la demande (${response.status}).`),{status:response.status});
    if (!data) throw new Error('Le serveur a renvoyé une réponse vide.');
    return data;
  } catch (error) {
    if (timedOut) throw new Error('Le serveur ne répond pas. Actualise le carnet avant de relancer la génération : elle peut avoir été enregistrée.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort',abort); }
};
export const requestId = () => {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else return `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `event-${Array.from(bytes,(value) => value.toString(16).padStart(2,'0')).join('')}`;
};
