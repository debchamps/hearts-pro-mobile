
import { Language } from '../types';
import { Preferences } from '@capacitor/preferences';

export const RTL_LANGUAGES: Language[] = ['ar'];
const LANG_STORAGE_KEY = 'PREF_USER_LANG';

export const DEFAULT_TRANSLATIONS: Record<Language, any> = {
  en: {
    common: {
      settings: "Settings",
      language: "Language",
      close: "Close",
      back: "Back",
      continue: "Continue",
      score: "Score",
      round: "Round",
      points: "Points",
      tricks: "Tricks",
      bid: "Bid",
      loading: "Loading...",
      ai_translate: "AI Auto-Translate",
      ai_translate_desc: "Generate culturally accurate gaming terms using Gemini 3.",
      home: "Home",
      how_to_play: "How to Play",
      history: "History",
      scoreboard: "Scoreboard",
      edit_avatar: "Edit Avatar",
      confirm: "Confirm",
    },
    hearts: {
      pass_3_left: "Pass 3 Cards Left",
      pass_3_right: "Pass 3 Cards Right",
      pass_3_across: "Pass 3 Cards Across",
      lead_2_clubs: "2 of Clubs Leads",
      hearts_not_broken: "Hearts not broken",
      must_follow_suit: "Must follow {suit}",
      round_end: "Round End",
      game_over: "Game Over",
      shoot_moon: "Shoot the Moon!",
      passing_phase: "Passing Phase",
    }
  },
  hi: {
    common: {
      settings: "सेटिंग्स",
      language: "भाषा",
      close: "बंद करें",
      back: "पीछे",
      continue: "जारी रखें",
      score: "स्कोर",
      round: "राउंड",
      points: "अंक",
      tricks: "चाले",
      bid: "बोली",
      loading: "लोड हो रहा है...",
      ai_translate: "AI ऑटो-अनुवाद",
      ai_translate_desc: "Gemini 3 का उपयोग करके अनुवाद करें।",
      home: "होम",
      how_to_play: "कैसे खेलें",
      history: "इतिहास",
      scoreboard: "स्कोरबोर्ड",
      edit_avatar: "अवतार बदलें",
      confirm: "पुष्टि करें",
    },
    hearts: {
      pass_3_left: "3 कार्ड बाएं भेजें",
      pass_3_right: "3 कार्ड दाएं भेजें",
      pass_3_across: "3 कार्ड सामने भेजें",
      lead_2_clubs: "चिड़ी की दुक्की की चाल",
      hearts_not_broken: "दिल (Hearts) अभी नहीं टूटे हैं",
      must_follow_suit: "{suit} की चाल चलें",
      round_end: "राउंड समाप्त",
      game_over: "खेल समाप्त",
      shoot_moon: "चांद पर निशाना!",
      passing_phase: "कार्ड भेजने का चरण",
    }
  },
  bn: {
    common: {
      settings: "সেটিংস",
      language: "ভাষা",
      close: "বন্ধ করুন",
      back: "ফিরে যান",
      continue: "চালিয়ে যান",
      score: "স্কোর",
      round: "রাউন্ড",
      points: "পয়েন্ট",
      tricks: "দান",
      bid: "ডাক",
      loading: "লোড হচ্ছে...",
      ai_translate: "AI অটো-অনুবাদ",
      ai_translate_desc: "Gemini 3 ব্যবহার করে অনুবাদ করুন।",
      home: "হোম",
      how_to_play: "কিভাবে খেলবেন",
      history: "ইতিহাস",
      scoreboard: "স্কোরবোর্ড",
      edit_avatar: "অবতার পরিবর্তন",
      confirm: "নিশ্চিত করুন",
    },
    hearts: {
      pass_3_left: "৩টি কার্ড বামে দিন",
      pass_3_right: "৩টি কার্ড ডানে দিন",
      pass_3_across: "৩টি কার্ড সামনে দিন",
      lead_2_clubs: "চিড়িতন ২ দিয়ে শুরু",
      hearts_not_broken: "হার্টস এখনো ভাঙেনি",
      must_follow_suit: "{suit} কার্ড দিন",
      round_end: "রাউন্ড শেষ",
      game_over: "খেলা শেষ",
      shoot_moon: "চাঁদ জয়!",
      passing_phase: "কার্ড পরিবর্তনের পর্যায়",
    }
  },
  ar: {
    common: {
      settings: "الإعدادات",
      language: "اللغة",
      close: "إغلاق",
      back: "رجوع",
      continue: "استمرار",
      score: "النتيجة",
      round: "الجولة",
      points: "نقاط",
      tricks: "لمّات",
      bid: "مزايدة",
      loading: "جاري التحميل...",
      ai_translate: "ترجمة ذكاء اصطناعي",
      ai_translate_desc: "توليد ترجمة دقيقة باستخدام Gemini 3.",
      home: "الرئيسية",
      how_to_play: "طريقة اللعب",
      history: "السجل",
      scoreboard: "لوحة النتائج",
      edit_avatar: "تغيير الصورة",
      confirm: "تأكيد",
    },
    hearts: {
      pass_3_left: "مرر 3 أوراق لليسار",
      pass_3_right: "مرر 3 أوراق لليمين",
      pass_3_across: "مرر 3 أوراق للمقابل",
      lead_2_clubs: "البداية بـ 2 سباتة",
      hearts_not_broken: "لم تكسر القلوب بعد",
      must_follow_suit: "يجب اتباع النوع {suit}",
      round_end: "نهاية الجولة",
      game_over: "انتهت اللعبة",
      shoot_moon: "أصبت القمر!",
      passing_phase: "مرحلة التمرير",
    }
  },
  es: {
    common: {
      settings: "Ajustes",
      language: "Idioma",
      close: "Cerrar",
      back: "Atrás",
      continue: "Continuar",
      score: "Puntuación",
      round: "Ronda",
      points: "Puntos",
      tricks: "Bazas",
      bid: "Apuesta",
      loading: "Cargando...",
      ai_translate: "Traducción IA",
      ai_translate_desc: "Traducir términos usando Gemini 3.",
      home: "Inicio",
      how_to_play: "Cómo Jugar",
      history: "Historial",
      scoreboard: "Marcador",
      edit_avatar: "Editar Avatar",
      confirm: "Confirmar",
    },
    hearts: {
      pass_3_left: "Pasar 3 a la Izquierda",
      pass_3_right: "Pasar 3 a la Derecha",
      pass_3_across: "Pasar 3 al Frente",
      lead_2_clubs: "Inicia el 2 de Tréboles",
      hearts_not_broken: "Corazones no rotos",
      must_follow_suit: "Debe seguir {suit}",
      round_end: "Fin de Ronda",
      game_over: "Juego Terminado",
      shoot_moon: "¡Disparar a la Luna!",
      passing_phase: "Fase de Intercambio",
    }
  },
  pt: {
    common: {
      settings: "Configurações",
      language: "Idioma",
      close: "Fechar",
      back: "Voltar",
      continue: "Continuar",
      score: "Pontuação",
      round: "Rodada",
      points: "Pontos",
      tricks: "Vazas",
      bid: "Lance",
      loading: "Carregando...",
      ai_translate: "Tradução IA",
      ai_translate_desc: "Traduzir termos usando Gemini 3.",
      home: "Início",
      how_to_play: "Como Jogar",
      history: "Histórico",
      scoreboard: "Placar",
      edit_avatar: "Editar Avatar",
      confirm: "Confirmar",
    },
    hearts: {
      pass_3_left: "Passar 3 para a Esquerda",
      pass_3_right: "Passar 3 para a Direita",
      pass_3_across: "Passar 3 para Frente",
      lead_2_clubs: "2 de Paus começa",
      hearts_not_broken: "Copas não quebradas",
      must_follow_suit: "Deve seguir {suit}",
      round_end: "Fim da Rodada",
      game_over: "Fim de Jogo",
      shoot_moon: "Acertar a Lua!",
      passing_phase: "Fase de Troca",
    }
  }
};

class I18nService {
  private currentLanguage: Language = 'en';
  private customTranslations: Partial<Record<Language, any>> = {};

  async init() {
    const { value } = await Preferences.get({ key: LANG_STORAGE_KEY });
    if (value && Object.keys(DEFAULT_TRANSLATIONS).includes(value)) {
      this.setLanguage(value as Language);
    }
  }

  setLanguage(lang: Language) {
    this.currentLanguage = lang;
    document.documentElement.dir = RTL_LANGUAGES.includes(lang) ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    Preferences.set({ key: LANG_STORAGE_KEY, value: lang });
  }

  getLanguage(): Language {
    return this.currentLanguage;
  }

  setCustomTranslations(translations: Record<Language, any>) {
    this.customTranslations = translations;
  }

  t(path: string, params?: Record<string, string>): string {
    const keys = path.split('.');
    
    let value = this.customTranslations[this.currentLanguage];
    if (!value || Object.keys(value).length === 0) {
      value = DEFAULT_TRANSLATIONS[this.currentLanguage];
    }

    for (const key of keys) {
      value = value?.[key];
    }

    if (typeof value !== 'string') {
      let engValue = DEFAULT_TRANSLATIONS['en'];
      for (const key of keys) {
        engValue = engValue?.[key];
      }
      value = typeof engValue === 'string' ? engValue : path;
    }

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        value = (value as string).replace(`{${k}}`, v);
      });
    }

    return value as string;
  }
}

export const i18n = new I18nService();
