
import React, { useEffect, useState } from 'react';
import { GameType, Language } from './types';
import { leaderboardService } from './services/leaderboardService';
import { i18n, DEFAULT_TRANSLATIONS } from './services/i18n';
import { translateAll } from './services/geminiService';
import { Overlay } from './SharedComponents';
import { Preferences } from '@capacitor/preferences';
import { DebugAuthMode, getDebugAuthMode, setDebugAuthMode } from './client/online/network/authMode';

const GAMES_LIST = [
  { id: 'hearts', name: 'Hearts', icon: '♥️', available: true, color: 'text-red-600' },
  { id: 'spades', name: 'Spades', icon: '♠️', available: true, color: 'text-indigo-900' },
  { id: 'callbreak', name: 'Callbreak', icon: '👑', available: true, color: 'text-purple-600' },
  { id: 'bray', name: 'Bray', icon: '🃏', available: false, color: 'text-amber-600' },
  { id: '29', name: '29', icon: '🎴', available: false, color: 'text-emerald-600' },
  { id: 'bridge', name: 'Bridge', icon: '🌉', available: false, color: 'text-cyan-600' },
];

const LANGUAGES: { id: Language; label: string; icon: string }[] = [
  { id: 'en', label: 'English', icon: '🇺🇸' },
  { id: 'hi', label: 'हिन्दी', icon: '🇮🇳' },
  { id: 'bn', label: 'বাংলা', icon: '🇧🇩' },
  { id: 'ar', label: 'العربية', icon: '🇦🇪' },
  { id: 'es', label: 'Español', icon: '🇪🇸' },
  { id: 'pt', label: 'Português', icon: '🇧🇷' },
];

const PERSISTED_TRANSLATIONS_KEY = 'PERSISTED_AI_TRANSLATIONS';

export function Home({ onSelectGame, onSelectOnlineGame, onResumeGame }: { onSelectGame: (type: GameType) => void, onSelectOnlineGame: (type: GameType) => void, onResumeGame?: () => void }) {
  const [showSettings, setShowSettings] = useState(false);
  const [currentLang, setCurrentLang] = useState<Language>(i18n.getLanguage());
  const [isTranslating, setIsTranslating] = useState(false);
  const [generatedJson, setGeneratedJson] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<DebugAuthMode>('GOOGLE');

  useEffect(() => {
    leaderboardService.syncPendingScores();
    
    const loadTranslationsAndLang = async () => {
      // Initialize language from preferences
      await i18n.init();
      setCurrentLang(i18n.getLanguage());

      // Load AI translations if any
      const { value } = await Preferences.get({ key: PERSISTED_TRANSLATIONS_KEY });
      if (value) {
        const parsed = JSON.parse(value);
        i18n.setCustomTranslations(parsed);
        setGeneratedJson(JSON.stringify(parsed, null, 2));
      }

      const savedMode = getDebugAuthMode();
      if (savedMode) setAuthMode(savedMode);
    };
    loadTranslationsAndLang();
  }, []);

  const handleLanguageChange = (lang: Language) => {
    i18n.setLanguage(lang);
    setCurrentLang(lang);
  };

  const handleAiTranslate = async () => {
    setIsTranslating(true);
    try {
      const newTranslations = await translateAll(DEFAULT_TRANSLATIONS.en);
      i18n.setCustomTranslations(newTranslations);
      const jsonStr = JSON.stringify(newTranslations, null, 2);
      setGeneratedJson(jsonStr);
      
      await Preferences.set({
        key: PERSISTED_TRANSLATIONS_KEY,
        value: jsonStr
      });
      
      alert("AI Translation complete and persisted locally!");
    } catch (e) {
      alert("Translation failed. Check console.");
    } finally {
      setIsTranslating(false);
    }
  };

  const handleDownloadJson = () => {
    if (!generatedJson) return;
    const blob = new Blob([generatedJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'translations.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAuthModeChange = (mode: DebugAuthMode) => {
    setDebugAuthMode(mode);
    setAuthMode(mode);
  };

  const t = (path: string) => i18n.t(path);

  return (
    <div className="h-screen w-full flex flex-col felt-bg overflow-hidden relative">
      <div className="pt-[var(--safe-top)] px-6 pb-4 flex justify-between items-end">
         <div>
            <h1 className="text-4xl font-black text-yellow-500 italic tracking-tighter drop-shadow-lg mb-0.5">CARD HUB</h1>
            <p className="text-white/40 text-[9px] font-black uppercase tracking-[0.4em]">{t('common.home')}</p>
         </div>
         <div className="flex gap-2">
           <button 
             onClick={() => setShowSettings(true)}
             className="bg-white/10 text-white w-10 h-10 rounded-xl flex items-center justify-center shadow-lg border border-white/10 active:scale-95 transition-all"
           >
             ⚙️
           </button>
           {onResumeGame && (
              <button 
                onClick={onResumeGame}
                className="bg-yellow-500 text-black px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg border-b-4 border-yellow-700 active:translate-y-1 transition-all"
              >
                Resume
              </button>
           )}
         </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-24 grid grid-cols-2 gap-4 content-start pt-4">
         {GAMES_LIST.map((game) => (
           <div key={game.id} className="relative">
              <div
                className={`relative aspect-[4/5] rounded-[2rem] p-5 flex flex-col items-center justify-between border-2 transition-all duration-300 group ${game.available ? 'bg-black/40 border-white/10 shadow-2xl hover:border-white/30' : 'bg-black/60 border-white/5 opacity-50 grayscale cursor-not-allowed'}`}
              >
                  <div className={`w-10 h-10 bg-white rounded-xl flex items-center justify-center text-xl shadow-inner border border-white/40 group-hover:scale-110 transition-transform ${game.color}`}>
                    {game.icon}
                  </div>
                  <div className="flex flex-col items-center w-full gap-2">
                    <span className="text-lg font-black uppercase tracking-tight text-white mb-1">{game.name}</span>
                    {game.available ? (
                      <div className="grid grid-cols-2 gap-2 w-full">
                        <button
                          onClick={() => onSelectGame(game.id.toUpperCase() as GameType)}
                          className="py-2 rounded-xl bg-green-500 text-black text-[8px] font-black uppercase tracking-widest active:scale-95"
                        >
                          Offline
                        </button>
                        <button
                          onClick={() => onSelectOnlineGame(game.id.toUpperCase() as GameType)}
                          className="py-2 rounded-xl bg-cyan-500 text-black text-[8px] font-black uppercase tracking-widest active:scale-95"
                        >
                          Online
                        </button>
                      </div>
                    ) : (
                      <span className="text-[8px] font-black uppercase tracking-widest text-yellow-500/80">Coming Soon</span>
                    )}
                  </div>
              </div>
           </div>
         ))}
      </div>

      {showSettings && (
        <Overlay title={t('common.settings')} subtitle="Configuration" fullWidth>
           <div className="w-full text-left space-y-6 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
              <div>
                 <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3 block">{t('common.language')}</label>
                 <div className="grid grid-cols-3 gap-2">
                    {LANGUAGES.map(lang => (
                      <button
                        key={lang.id}
                        onClick={() => handleLanguageChange(lang.id)}
                        className={`flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all ${currentLang === lang.id ? 'bg-yellow-500 border-white text-black scale-105' : 'bg-white/5 border-white/5 text-white/60'}`}
                      >
                         <span className="text-2xl mb-1">{lang.icon}</span>
                         <span className="text-[9px] font-black uppercase">{lang.label}</span>
                      </button>
                    ))}
                 </div>
              </div>

              <div className="bg-white/5 p-5 rounded-[2rem] border border-white/10 space-y-3">
                 <div className="text-left">
                    <h4 className="text-sm font-black text-cyan-400 uppercase tracking-widest">Auth Mode (Debug)</h4>
                    <p className="text-[9px] text-white/30 uppercase">Use CUSTOM for browser/dev QA, GOOGLE for token-based login</p>
                 </div>
                 <div className="grid grid-cols-2 gap-2">
                    {(['CUSTOM', 'GOOGLE'] as DebugAuthMode[]).map(mode => (
                      <button
                        key={mode}
                        onClick={() => handleAuthModeChange(mode)}
                        className={`py-3 rounded-xl border-2 text-[10px] font-black uppercase tracking-widest transition-all ${authMode === mode ? 'bg-cyan-500 text-black border-white scale-[1.02]' : 'bg-white/5 text-white border-white/10'}`}
                      >
                        {mode}
                      </button>
                    ))}
                 </div>
              </div>

              <div className="bg-white/5 p-5 rounded-[2rem] border border-white/10 space-y-4">
                 <div className="flex justify-between items-start">
                    <div className="text-left">
                       <h4 className="text-sm font-black text-indigo-400 uppercase tracking-widest">{t('common.ai_translate')}</h4>
                       <p className="text-[9px] text-white/30 uppercase max-w-[180px]">{t('common.ai_translate_desc')}</p>
                    </div>
                    <button 
                      onClick={handleAiTranslate}
                      disabled={isTranslating}
                      className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl transition-all ${isTranslating ? 'animate-spin opacity-50 bg-white/5' : 'bg-indigo-600 hover:bg-indigo-500 active:scale-90 shadow-xl'}`}
                    >
                      {isTranslating ? '⏳' : '🪄'}
                    </button>
                 </div>

                 {generatedJson && (
                   <div className="animate-fadeIn space-y-3">
                      <div className="bg-black/40 p-3 rounded-xl border border-white/5 max-h-32 overflow-y-auto">
                        <pre className="text-[8px] text-green-500 font-mono whitespace-pre-wrap">{generatedJson}</pre>
                      </div>
                      <button 
                        onClick={handleDownloadJson}
                        className="w-full py-2 bg-white/10 text-white rounded-xl text-[9px] font-black uppercase tracking-widest border border-white/5 hover:bg-white/20 transition-all"
                      >
                        💾 Download translations.json
                      </button>
                      <p className="text-[7px] text-center text-white/20 uppercase font-bold italic">
                        Tip: Save this file into services/i18n.ts to persist forever
                      </p>
                   </div>
                 )}
              </div>

              <button 
                onClick={() => setShowSettings(false)}
                className="w-full py-4 bg-yellow-500 text-black rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl mt-4"
              >
                {t('common.close')}
              </button>
           </div>
        </Overlay>
      )}
    </div>
  );
}
