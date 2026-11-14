// Seeded corpus fixtures for Mock Mode (mirrors all 14 real CityLab corpus files)
export const SEED_PATIENTS = [
  { patient_id: "P001", name: "Alice Smith", age: 28, sex: "female", test_count: 2, file: "report_P001_Alice_Smith_CBC.md", tag: "ok", tagLabel: "Normal" },
  { patient_id: "P002", name: "Bob Jones", age: 35, sex: "female", test_count: 1, file: "report_P002_Bob_Jones_Liver.md", tag: "conv", tagLabel: "Alias + Limit=45" },
  { patient_id: "P003", name: "Charlie Brown", age: null, sex: null, test_count: 1, file: "report_P003_Charlie_Brown_Sugar_NoDemo.md", tag: "demo", tagLabel: "Missing Age/Sex" },
  { patient_id: "P004", name: "Diana Prince", age: 42, sex: "female", test_count: 2, file: "report_P004_Diana_Prince_Hem_Urgent.md", tag: "urgent", tagLabel: "URGENT Hb 6.5" },
  { patient_id: "P005", name: "Ethan Hunt", age: 50, sex: "male", test_count: 1, file: "report_P005_Ethan_Hunt_Sugar_UnitConv.md", tag: "conv", tagLabel: "6.0 mmol/L Conv" },
  { patient_id: "P006", name: "Fiona Gallagher", age: 22, sex: "female", test_count: 1, file: "report_P006_Fiona_UnknownTest.md", tag: "unknown", tagLabel: "Unknown Ferritin" },
  { patient_id: "P007", name: "George Costanza", age: 65, sex: "male", test_count: 1, file: "report_P007_George_Thyroid.md", tag: "ok", tagLabel: "Normal TSH" },
  { patient_id: "P008", name: "Haley Dunphy", age: 19, sex: "female", test_count: 2, file: "report_P008_Haley_Urine.md", tag: "ok", tagLabel: "Urine Normal" },
  { patient_id: "P009", name: "Ian Malcolm", age: 48, sex: "male", test_count: 2, file: "report_P009_Ian_Liver_High.md", tag: "conv", tagLabel: "High ALT/AST" },
  { patient_id: "P010", name: "Julia Child", age: 55, sex: "female", test_count: 1, file: "report_P010_Julia_Cholesterol.md", tag: "conv", tagLabel: "Boundary=200" },
  { patient_id: "P011", name: "Kevin Hart", age: 40, sex: "male", test_count: 2, file: "report_P011_Kevin_CBC.md", tag: "conv", tagLabel: "High WBC / Low PLT" },
  { patient_id: "P012", name: "Laura Croft", age: 32, sex: null, test_count: 1, file: "report_P012_Laura_AST_MissingSex.md", tag: "demo", tagLabel: "Missing Sex" },
  { patient_id: "P013", name: "Michael Scott", age: 45, sex: "male", test_count: 1, file: "report_P013_Michael_Sugar_Urgent.md", tag: "urgent", tagLabel: "URGENT Sugar 350" },
  { patient_id: "P014", name: "Nancy Drew", age: 29, sex: "female", test_count: 2, file: "report_P014_Nancy_Multiple.md", tag: "conv", tagLabel: "Aliases FBS/SGOT" },
];

export const TRICKY_SAMPLE_REPORT = `# CITYLAB DIAGNOSTICS - CUSTOM ENCOUNTER REPORT
* **Patient Full Name**: Zara Siddiqui
* **Recorded Age**: 38
* **Biological Sex**: Female

## SECTION III: ANALYTICAL RESULTS
- **SGPT**: 45 U/L
- **Fasting Blood Sugar**: 6.0 mmol/L
- **Hemoglobin**: 6.8 g/dL
- **Serum Ferritin**: 30 ng/mL
`;
