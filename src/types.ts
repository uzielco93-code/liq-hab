export interface ConceptValue {
  code: string;
  name: string;
  value: number;
  type: 'DV' | 'RT';
}

export interface EmployeeStub {
  idHr: string;
  name: string;
  concepts: Record<string, ConceptValue>;
  liquido: number;
  remCAporte: number;
  remSAporte: number;
  salarioFamiliar: number;
  totalDescuentos: number;
}

export interface ParsingLog {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: string;
}

export interface ComparisonResult {
  code: string;
  name: string;
  calculated: number;
  reported: number;
  difference: number;
  type: 'DV' | 'RT';
}

export interface ProcessingResult {
  employees: EmployeeStub[];
  conceptsMap: Record<string, { name: string; type: 'DV' | 'RT' }>;
  dvKeys: string[];
  rtK: string[]; // RT keys
  totalsReported: Record<string, number>;
  reportedLiquido: number;
  calculatedLiquido: number;
  comparisons: ComparisonResult[];
  hasDiscrepancies: boolean;
}
