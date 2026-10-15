import { useSyncExternalStore } from "react";

export type Lang = "ka" | "en";

const STORAGE_KEY = "lattice-lang";
let currentLang: Lang = ((): Lang => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "en" ? "en" : "ka";
  } catch {
    return "ka";
  }
})();

const listeners = new Set<() => void>();

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang) {
  if (lang !== currentLang) {
    currentLang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
    listeners.forEach((l) => l());
  }
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => currentLang,
    () => "ka",
  );
}

export function tr(kaText: string, enText: string): string {
  return currentLang === "ka" ? kaText : enText;
}

// Dictionary for new strings (English key -> Georgian translation)
export const dictionary: Record<string, string> = {
  Flows: "ფლოუები",
  Studies: "კვლევები",
  Study: "კვლევა",
  Overview: "მიმოხილვა",
  Parameters: "პარამეტრები",
  Outcomes: "შედეგები",
  Constraints: "შეზღუდვები",
  Model: "მოდელი",
  Evidence: "მტკიცებულებები",
  Candidates: "კანდიდატები",
  Analysis: "ანალიზი",
  Plan: "გეგმა",
  Audit: "აუდიტი",
  Report: "ანგარიში",
  "Run screening": "სკრინინგის გაშვება",
  "New study": "ახალი კვლევა",
  Archive: "დაარქივება",
  Save: "შენახვა",
  Cancel: "გაუქმება",
  Delete: "წაშლა",
  Add: "დამატება",
  Edit: "რედაქტირება",
  Generate: "გენერაცია",
  Import: "იმპორტი",
  Export: "ექსპორტი",
  Download: "ჩამოტვირთვა",
  Status: "სტატუსი",
  Reason: "მიზეზი",
  Unit: "ერთეული",
  Kind: "ტიპი",
  Role: "როლი",
  Controlled: "მართვადი",
  Uncertain: "განუსაზღვრელი",
  Fixed: "ფიქსირებული",
  Continuous: "უწყვეტი",
  Integer: "მთელი",
  Categorical: "კატეგორიული",
  Binary: "ორობითი",
  Minimize: "მინიმიზაცია",
  Maximize: "მაქსიმიზაცია",
  None: "არა",
  Open: "ღია",
  Excluded: "გამორიცხული",
  Deprioritised: "დეპრიორიტეტიზებული",
  Recommended: "რეკომენდებული",
  "Tested Pass": "შემოწმებული · წარმატებული",
  "Tested Fail": "შემოწმებული · წარუმატებელი",
};

export function tk(key: string): string {
  if (currentLang === "ka" && dictionary[key]) {
    return dictionary[key];
  }
  return key;
}
