import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import el from "../locales/el.json";
import en from "../locales/en.json";

const LANG_KEY = "seatplan.lang";

function initialLanguage(): string {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "el" || saved === "en") return saved;
  } catch {
    // ignore
  }
  return navigator.language?.toLowerCase().startsWith("el") ? "el" : "en";
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, el: { translation: el } },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(LANG_KEY, lng);
  } catch {
    // ignore
  }
});
document.documentElement.lang = i18n.language;

export default i18n;
