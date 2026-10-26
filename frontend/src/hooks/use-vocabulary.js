import { useCallback, useEffect, useRef, useState } from 'react';

const GOALS = [5, 10, 15, 20];

const readResponse = async (response) => {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || `Le serveur a refusé la demande (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  if (!data || typeof data !== 'object') throw new Error('La réponse du serveur est incomplète.');
  return data;
};

const validGoal = (settings) => settings && GOALS.includes(Number(settings.goal));
const connectionFailure = (error) => !error.status || error.status >= 500 || [401, 403].includes(error.status);
const writeFailure = (request, error) => request?.timedOut
  ? new Error('Le serveur n’a pas confirmé l’enregistrement à temps. Synchronise le carnet avant de réessayer.')
  : error;

// Le serveur est la source commune du carnet, des révisions et de l’objectif.
export const useVocabulary = ({ editing = false, sessionActive = false } = {}) => {
  const [words, setWords] = useState([]);
  const [goal, setGoal] = useState(10);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [goalError, setGoalError] = useState('');
  const [lastSynced, setLastSynced] = useState(null);
  const mounted = useRef(false);
  const loaded = useRef(false);
  const busy = useRef(false);
  const sequence = useRef(0);
  const activeRead = useRef(null);
  const activeWrite = useRef(null);
  const interaction = useRef({ editing, sessionActive });
  const connection = useRef({ loading, loadError });
  interaction.current = { editing, sessionActive };
  connection.current = { loading, loadError };

  const applyState = useCallback((data, requireSettings = false) => {
    if (!Array.isArray(data.words) || (requireSettings && !validGoal(data.settings)) || (data.settings && !validGoal(data.settings))) {
      throw new Error('Le serveur n’a pas renvoyé un carnet et des paramètres valides.');
    }
    if (!mounted.current) return;
    setWords(data.words);
    if (data.settings) {
      setGoal(Number(data.settings.goal));
      setGoalError('');
    }
    setLoadError('');
    setLastSynced(new Date());
    loaded.current = true;
  }, []);

  const refresh = useCallback(async ({ initial = false, force = false } = {}) => {
    if (!mounted.current || busy.current) return false;
    const recovering = !!connection.current.loadError;
    if (!force && (((interaction.current.editing || interaction.current.sessionActive) && !recovering) || document.visibilityState === 'hidden')) return false;
    // Toute réponse d’une ancienne lecture est ignorée, même si son annulation arrive trop tard.
    const requestSequence = ++sequence.current;
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
    if (initial && !loaded.current) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await fetch('/api/vocabulary', { cache: 'no-store', signal: controller.signal }).then(readResponse);
      if (!mounted.current || controller.signal.aborted || requestSequence !== sequence.current) return false;
      applyState(data, true);
      return true;
    } catch (error) {
      if (!mounted.current || (controller.signal.aborted && !timedOut) || requestSequence !== sequence.current) return false;
      setLoadError(timedOut ? 'Le serveur ne répond pas. Vérifie que tu es connecté au même réseau que lui.' : error.message || 'Le serveur est momentanément inaccessible.');
      return false;
    } finally {
      window.clearTimeout(timeout);
      if (mounted.current && requestSequence === sequence.current) {
        setLoading(false);
        setRefreshing(false);
        activeRead.current = null;
      }
    }
  }, [applyState]);

  useEffect(() => {
    mounted.current = true;
    refresh({ initial: true, force: true });
    const synchronise = () => { refresh(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') synchronise(); };
    const timer = window.setInterval(synchronise, 20_000);
    window.addEventListener('focus', synchronise);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted.current = false;
      sequence.current += 1;
      activeRead.current?.abort();
      activeWrite.current?.controller.abort();
      window.clearTimeout(activeWrite.current?.timeout);
      window.clearInterval(timer);
      window.removeEventListener('focus', synchronise);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    // Une nouvelle lecture après une édition ou une séance récupère les autres appareils.
    if (loaded.current && !editing && !sessionActive) refresh();
  }, [editing, sessionActive, refresh]);

  const beginWrite = useCallback(() => {
    if (connection.current.loading || connection.current.loadError) throw new Error('Synchronise le carnet avec le serveur avant d’enregistrer.');
    if (busy.current) throw new Error('Un enregistrement est en cours. Réessaie dans un instant.');
    busy.current = true;
    sequence.current += 1;
    activeRead.current?.abort();
    activeRead.current = null;
    const controller = new AbortController();
    const request = { controller, timedOut: false, timeout: null };
    request.timeout = window.setTimeout(() => { request.timedOut = true; controller.abort(); }, 20_000);
    activeWrite.current = request;
    setRefreshing(false);
    setSaving(true);
    return request;
  }, []);

  const finishWrite = useCallback((request) => {
    window.clearTimeout(request.timeout);
    if (activeWrite.current === request) {
      busy.current = false;
      activeWrite.current = null;
      if (mounted.current) setSaving(false);
    }
  }, []);

  const mutate = useCallback(async (payload) => {
    const request = beginWrite();
    const { controller } = request;
    try {
      const data = await fetch('/api/vocabulary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }).then(readResponse);
      if (controller.signal.aborted) throw new Error('L’enregistrement a été interrompu. Synchronise le carnet avant de réessayer.');
      applyState(data);
      return data;
    } catch (error) {
      const issue = writeFailure(request, error);
      if (mounted.current && (request.timedOut || !controller.signal.aborted) && connectionFailure(issue)) setLoadError(issue.message);
      throw issue;
    } finally {
      finishWrite(request);
    }
  }, [applyState, beginWrite, finishWrite]);

  const saveGoal = useCallback(async (nextGoal) => {
    const value = Number(nextGoal);
    if (!GOALS.includes(value)) throw new Error('Choisis 5, 10, 15 ou 20 mots par jour.');
    setGoalError('');
    let request;
    try {
      request = beginWrite();
      const { controller } = request;
      setSavingGoal(true);
      const data = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: value }),
        signal: controller.signal,
      }).then(readResponse);
      if (!validGoal(data.settings)) throw new Error('Le serveur n’a pas confirmé le nouvel objectif.');
      if (controller.signal.aborted) throw new Error('L’enregistrement de l’objectif a été interrompu.');
      if (mounted.current && !controller.signal.aborted) {
        setGoal(Number(data.settings.goal));
        setGoalError('');
        setLoadError('');
        setLastSynced(new Date());
      }
    } catch (error) {
      const issue = writeFailure(request, error);
      if (mounted.current) {
        setGoalError(`${issue.message} Le changement n’a pas été confirmé. Synchronise pour vérifier l’objectif enregistré.`);
        if (request && (request.timedOut || !request.controller.signal.aborted) && connectionFailure(issue)) setLoadError(issue.message);
      }
      throw issue;
    } finally {
      if (request) finishWrite(request);
      if (request && mounted.current) setSavingGoal(false);
    }
  }, [beginWrite, finishWrite]);

  return { words, goal, loading, refreshing, saving, savingGoal, loadError, goalError, lastSynced, refresh, mutate, saveGoal };
};
