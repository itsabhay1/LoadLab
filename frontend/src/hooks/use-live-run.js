import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { createRunSocket, releaseRunSocket } from '../services/socket';

export function useLiveRun(runId) {
  const [run, setRun] = useState();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState();
  const [connected, setConnected] = useState(false);

  const synchronize = useCallback(async () => {
    try {
      const response = await api.getRun(runId);
      setRun((current) => ({
        ...response.run,
        ...(['QUEUED', 'RUNNING'].includes(response.run.status) && current?.liveMetrics
          ? { liveMetrics: current.liveMetrics }
          : {}),
      }));
      setError(undefined);
    } catch (syncError) {
      setError(syncError);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    let active = true;
    const socket = createRunSocket();
    const onConnect = () => {
      if (!active) return;
      setConnected(true);
      socket.emit('run:subscribe', runId);
      void synchronize();
    };
    const onDisconnect = () => active && setConnected(false);
    const onUpdate = (update) => {
      if (!active || update.runId !== runId) return;
      setRun((current) => ({
        ...current,
        status: update.status,
        ...(update.metrics ? { liveMetrics: update.metrics } : {}),
        ...(update.reason ? { reason: update.reason } : {}),
        ...(update.startedAt ? { startedAt: update.startedAt } : {}),
        ...(update.finishedAt ? { finishedAt: update.finishedAt } : {}),
      }));
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('run:update', onUpdate);
    socket.connect();
    queueMicrotask(() => {
      if (active) void synchronize();
    });

    return () => {
      active = false;
      socket.emit('run:unsubscribe', runId);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('run:update', onUpdate);
      releaseRunSocket(socket);
    };
  }, [runId, synchronize]);

  return { run, loading, error, connected, refresh: synchronize };
}
