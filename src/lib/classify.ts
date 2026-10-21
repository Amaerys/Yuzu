// Rule-based first-pass classifier: assigns System / Specialty tags to medical notes from their text.
// It only adds "auto::" tags; the user's own tags and deck paths are never touched, and anything
// can be corrected later in the browser. Keyword lists are deliberately conservative.

const SYSTEMS: Record<string, string[]> = {
  Cardiovascular: ["cardiac", "heart", "myocard", "ecg", "ekg", "arrhythm", "atrial", "ventric", "stemi", "angina", "coronary", "aortic", "aorta", "valve", "mitral", "tachycard", "bradycard", "hypertens", "pericard", "endocard", "heart failure", "cardiomyopath", "qrs", "qt ", "av block", "bundle branch", "wpw", "fibrillation", "flutter", "shock", "syncope", "vasopress", "amiodarone", "digoxin", "beta-block", "beta block", "troponin", "cardioversion", "defibrill"],
  Respiratory: ["lung", "pulmon", "pneumon", "asthma", "copd", "bronch", "respirat", "pleura", "pneumothorax", "ventilat", "intubat", "airway", "hypoxi", "oxygen", "dyspnea", "pe ", "pulmonary embol", "tuberculosis", "spirometr", "fev1", "wheez", "ards", "cpap", "bipap", "capnograph"],
  Gastrointestinal: ["gastr", "bowel", "colon", "hepat", "liver", "pancrea", "bili", "esophag", "oesophag", "appendic", "diarrh", "constipat", "cirrhosis", "gi bleed", "ulcer", "crohn", "colitis", "cholecyst", "gallbladder", "cholang", "hernia", "vomit", "ascites", "jaundice", "peptic", "h. pylori", "varices", "melena", "hematemesis"],
  Renal: ["renal", "kidney", "nephr", "dialysis", "creatinine", "glomerul", "aki", "ckd", "hyperkal", "hypokal", "hyponatr", "hypernatr", "acidosis", "alkalosis", "urinary", "ureter", "bladder", "pyeloneph", "cystitis", "uti", "rhabdomyolysis", "electrolyte", "sodium", "potassium"],
  Neurology: ["neuro", "brain", "stroke", "seizure", "epilep", "headache", "migraine", "meningit", "encephal", "spinal cord", "cerebr", "cranial nerve", "gcs", "glasgow", "intracranial", "subarachnoid", "subdural", "epidural", "myasthenia", "guillain", "parkinson", "multiple sclerosis", "vertigo", "neuropath", "status epilepticus", "tia ", "aphasia", "hemipar", "dementia", "delirium"],
  Endocrine: ["diabet", "insulin", "thyroid", "adrenal", "cortisol", "pituitar", "dka", "hhs", "hypoglyc", "hyperglyc", "cushing", "addison", "pheochromocytoma", "hyperthyroid", "hypothyroid", "glucose", "hba1c", "metformin", "parathyroid", "calcium", "hypercalc", "hypocalc", "prolactin"],
  "Hematology & Oncology": ["anemia", "anaemia", "hemoglobin", "haemoglobin", "platelet", "thrombocyt", "coagul", "warfarin", "heparin", "doac", "anticoag", "leukemia", "leukaemia", "lymphoma", "myeloma", "sickle", "transfusion", "neutropeni", "dic ", "ttp", "itp", "hemophilia", "haemophilia", "von willebrand", "tumor", "tumour", "cancer", "carcinoma", "malignan", "chemotherap", "metasta", "oncolog", "inr "],
  "Infectious Disease": ["infect", "sepsis", "septic", "antibiotic", "bacteri", "viral", "virus", "fungal", "hiv", "hepatitis", "malaria", "cellulitis", "abscess", "mrsa", "pneumococc", "staph", "strep", "vancomycin", "ceftriaxone", "amoxicillin", "penicillin", "macrolide", "azithro", "cipro", "fluoroquinolone", "tetanus", "rabies", "covid", "influenza", "mers", "brucell", "tb "],
  "Musculoskeletal & Trauma": ["fracture", "dislocat", "sprain", "tendon", "ligament", "orthop", "bone", "joint", "arthritis", "gout", "osteo", "spine", "vertebra", "back pain", "compartment syndrome", "trauma", "splint", "cast", "reduction", "ottawa", "ankle", "wrist", "shoulder", "hip ", "knee", "femur", "tibia", "radius", "scaphoid", "pelvis", "rotator"],
  "Dermatology": ["skin", "rash", "derm", "eczema", "psoriasis", "urticaria", "burn", "wound", "laceration", "melanoma", "acne", "scabies", "impetigo", "stevens-johnson", "sjs", "ten ", "erythema", "vesicle", "bulla", "pruritus", "herpes zoster", "tinea"],
  "Obstetrics & Gynecology": ["pregnan", "obstetric", "gynec", "gynaec", "uterus", "uterine", "ovar", "ectopic", "eclampsia", "preeclampsia", "labor", "labour", "delivery", "fetal", "foetal", "placenta", "hcg", "menstru", "vaginal", "cervical", "pelvic inflammatory", "pid ", "miscarriage", "postpartum", "contracept", "trimester"],
  Pediatrics: ["pediatric", "paediatric", "child", "infant", "neonat", "newborn", "croup", "bronchiolitis", "intussusception", "pyloric stenosis", "kawasaki", "febrile seizure", "epiglottitis", "pertussis", "measles", "varicella", "developmental", "vaccin", "immuniz", "congenital"],
  Psychiatry: ["psychiatr", "depress", "anxiety", "schizophren", "bipolar", "psychos", "suicid", "antipsychotic", "ssri", "lithium", "serotonin syndrome", "neuroleptic malignant", "delirium tremens", "withdrawal", "panic", "ptsd", "ocd", "eating disorder", "anorexia", "bulimia", "mania"],
  "Toxicology & Environmental": ["overdose", "poison", "toxic", "antidote", "acetaminophen", "paracetamol", "salicylate", "aspirin overdose", "tricyclic", "carbon monoxide", "cyanide", "methanol", "ethylene glycol", "organophosphate", "opioid", "naloxone", "benzodiazepine", "heat stroke", "hyperthermia", "hypothermia", "drowning", "snake", "scorpion", "envenom", "anion gap", "activated charcoal", "lithium toxicity", "digoxin toxicity"],
  "ENT & Eye": ["ear", "otitis", "sinusitis", "epistaxis", "tonsil", "pharyngitis", "peritonsillar", "hearing", "vertigo", "eye", "ocular", "retina", "glaucoma", "conjunctivitis", "uveitis", "cornea", "visual acuity", "optic", "orbital", "iritis", "keratitis", "red eye", "nasal"],
  Immunology: ["anaphyla", "allerg", "immun", "lupus", "sle ", "rheumatoid", "vasculitis", "sarcoid", "autoimmune", "transplant", "antibod", "complement", "hypersensitivity", "angioedema", "epinephrine", "adrenaline", "antihistamine"],
};

const SPECIALTY_FROM_SOURCE: [RegExp, string][] = [
  [/emergency|ER\b|\bEM\b|FRCEM|MRCEM|inservice|ACLS|ATLS/i, "Emergency Medicine"],
  [/POCUS|ultrasound|FAST/i, "Point-of-care Ultrasound"],
  [/radiolog|RadCases|x-?ray|CT\b|MRI/i, "Radiology"],
  [/EKG|ECG/i, "Cardiology"],
  [/lab medicine|laborator/i, "Laboratory Medicine"],
  [/internal medicine/i, "Internal Medicine"],
  [/surgery|orthop/i, "Surgery"],
  [/pharmacolog/i, "Pharmacology"],
  [/step ?1/i, "USMLE Step 1"],
  [/occupational|arbeits/i, "Occupational Medicine"],
];

const esc = (k: string) => k.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Short keywords must match whole words ("uti" must not hit "distribution"); longer ones match as prefixes.
const compiled = Object.entries(SYSTEMS).map(([sys, kws]) => [sys, kws.map((k) => new RegExp(k.trim().length <= 4 ? `\\b${esc(k)}\\b` : `\\b${esc(k)}`, "g"))] as const);

export function classifyText(text: string): string[] {
  const t = " " + text.toLowerCase().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") + " ";
  const scores: [string, number][] = [];
  for (const [sys, kws] of compiled) {
    let s = 0;
    for (const re of kws) { re.lastIndex = 0; while (re.exec(t)) { s++; if (s > 6) break; } }
    if (s) scores.push([sys, s]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  if (!scores.length) return [];
  const [top, topScore] = scores[0];
  const out = [top];
  if (scores[1] && scores[1][1] >= Math.max(2, topScore * 0.6)) out.push(scores[1][0]);
  return out;
}

export function specialtiesFromSource(source: string): string[] {
  const out = new Set<string>();
  for (const [re, name] of SPECIALTY_FROM_SOURCE) if (re.test(source)) out.add(name);
  return [...out];
}

export const SYSTEM_NAMES = Object.keys(SYSTEMS);
