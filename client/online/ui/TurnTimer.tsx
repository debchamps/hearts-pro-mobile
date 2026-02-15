import React, { useEffect, useMemo, useState } from 'react';

export function TurnTimer({ deadlineMs, serverTimeMs, durationMs = 5000 }: { deadlineMs: number; serverTimeMs: number; durationMs?: number }) {
  const [now, setNow] = useState(serverTimeMs);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);

  const pct = useMemo(() => {
    const remaining = Math.max(0, deadlineMs - now);
    return Math.max(0, Math.min(1, remaining / Math.max(1, durationMs)));
  }, [deadlineMs, now, durationMs]);

  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - pct);

  return (
    <div className="w-14 h-14 relative">
      <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={radius} stroke="rgba(255,255,255,0.2)" strokeWidth="6" fill="transparent" />
        <circle
          cx="28"
          cy="28"
          r={radius}
          stroke={pct < 0.3 ? '#ef4444' : '#eab308'}
          strokeWidth="6"
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-white">
        {Math.ceil(Math.max(0, deadlineMs - now) / 1000)}
      </div>
    </div>
  );
}
