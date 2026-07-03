import * as pdfjs from 'pdfjs-dist';
import { EmployeeStub, ConceptValue, ComparisonResult, ProcessingResult } from '../types';

// Set PDF.js worker URL to a reliable CDN that matches the installed library version
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

/**
 * Parses Spanish/Argentine format numbers to numeric floats.
 * Handles thousands separator (.) and decimal separator (,).
 * Handles negative signs either at the start or trailing at the end (common in payrolls).
 */
export function es2f(s: string): number {
  if (!s) return 0;
  let clean = s.trim().replace(/[$\s]/g, '');
  let isNegative = false;
  
  if (clean.endsWith('-')) {
    isNegative = true;
    clean = clean.substring(0, clean.length - 1);
  } else if (clean.startsWith('-')) {
    isNegative = true;
    clean = clean.substring(1);
  }

  // payroll decimal format always separates decimals by commas (e.g. 10.903,57)
  if (clean.includes(',')) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else {
    // If no comma but has a dot, detect if it's thousands separator or decimal dot
    const lastDot = clean.lastIndexOf('.');
    if (lastDot !== -1 && clean.length - lastDot - 1 === 2) {
      // Treated as decimal dot (e.g., 12345.67)
    } else {
      // Treated as thousands dot (e.g., 10.000 -> 10000)
      clean = clean.replace(/\./g, '');
    }
  }

  const val = parseFloat(clean);
  return isNaN(val) ? 0 : isNegative ? -val : val;
}

/**
 * Groups PDF text items into lines with a coordinate tolerance (default 4 units).
 * This ensures that items slightly misaligned vertically are processed as the same row.
 */
export async function extractPdfLines(
  file: File,
  onProgress?: (current: number, total: number) => void
): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: buf });
  const pdf = await loadingTask.promise;
  const lines: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    
    // Group text items by Y coordinate (rounding with 4 units tolerance)
    const tolerance = 4;
    const byY: Record<number, { x: number; s: string }[]> = {};
    
    for (const item of content.items) {
      if ('str' in item) {
        const str = item.str;
        if (!str) continue;
        
        const x = item.transform[4];
        const y = item.transform[5];
        
        // Find existing Y group within tolerance
        let matchedY = Object.keys(byY).map(Number).find(ey => Math.abs(ey - y) < tolerance);
        if (matchedY === undefined) {
          matchedY = y;
          byY[matchedY] = [];
        }
        
        byY[matchedY].push({ x, s: str });
      }
    }
    
    // Sort Y groups descending (from top of page to bottom)
    const sortedYs = Object.keys(byY).map(Number).sort((a, b) => b - a);
    
    for (const y of sortedYs) {
      // Sort items within each line horizontally (from left to right)
      const row = byY[y].sort((a, b) => a.x - b.x).map(i => i.s).join(' ');
      if (row.trim()) {
        lines.push(row);
      }
    }
    
    if (onProgress) {
      onProgress(p, pdf.numPages);
    }
  }
  
  return lines;
}

/**
 * Parses individual employee receipts PDF and groups/consolidates duplicates.
 */
export function parseEmployeeReceipts(lines: string[], logFn: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void): EmployeeStub[] {
  const stubs: EmployeeStub[] = [];
  let currentStub: EmployeeStub | null = null;
  let expectLiq = false;

  for (let idx = 0; rowIdx < lines.length; idx++) {
    const line = lines[idx];
    if (!line) continue;
    const trimmed = line.trim();

    // Check for employee header line
    // Look for patterns like "Id. Hr: 125656158 Apellido y Nombre : QUERRO, ENRIQUE OMAR"
    const hrMatch = trimmed.match(/Id\.\s*Hr:?\s*(\d+)\s+Apellido\s+y\s+Nombre\s*:\s*([A-ZÁÉÍÓÚÜÑÀ\s,.\-]+?)(?:\s{2,}|\s+Centro\s+Pago|\s+Cargo|\s+Fecha|\s+$)/i);
    const fallbackMatch = trimmed.match(/Apellido\s+y\s+Nombre\s*:\s*([A-ZÁÉÍÓÚÜÑÀ\s,.\-]+?)(?:\s{2,}|\s+Centro|\s+Cargo|\s+Fecha|\s+$)/i);
    
    const nameMatch = hrMatch ? hrMatch[2] : (fallbackMatch ? fallbackMatch[1] : null);

    if (nameMatch) {
      if (currentStub) {
        stubs.push(currentStub);
      }
      
      const cleanName = nameMatch.trim().replace(/\s+/g, ' ');
      currentStub = {
        name: cleanName,
        concepts: {},
        liquido: 0
      };
      expectLiq = true;
      continue;
    }

    if (!currentStub) continue;

    // Scan for Liquido net pay
    // Standard format: single line with net value right after headers
    if (expectLiq) {
      const liqSolo = trimmed.match(/^([\d\.]+,\d{2})$/);
      if (liqSolo) {
        currentStub.liquido += es2f(liqSolo[1]);
        expectLiq = false;
        continue;
      }
      
      // Fallback within line content
      const liqLine = trimmed.match(/Liquido\s+([\d\.]+,\d{2})/i) || trimmed.match(/Liq\.\s*Pesos:\s*([\d\.]+,\d{2})/i);
      if (liqLine) {
        currentStub.liquido += es2f(liqLine[1]);
        expectLiq = false;
        continue;
      }
      
      if (!trimmed.startsWith('____')) {
        expectLiq = false;
      }
    }

    // Look for DV concepts (Haberes/Earnings)
    // Format: "DV <CODE> <Description> <Value>"
    const dvMatch = trimmed.match(/^DV\s+(\d+)\s+(.+?)\s+([\d\.]+,\d{2})$/);
    if (dvMatch) {
      const [, code, desc, valueStr] = dvMatch;
      const key = `DV_${code}`;
      const value = es2f(valueStr);
      
      if (!currentStub.concepts[key]) {
        currentStub.concepts[key] = {
          code,
          name: desc.trim(),
          value: 0,
          type: 'DV'
        };
      }
      currentStub.concepts[key].value += value;
      continue;
    }

    // Look for RT concepts (Descuentos/Deductions)
    // Format: "RT <CODE> <Description> <Value>"
    const rtMatch = trimmed.match(/^RT\s+(\d+)\s+(.+?)\s+([\d\.]+,\d{2})$/);
    if (rtMatch) {
      const [, code, desc, valueStr] = rtMatch;
      const key = `RT_${code}`;
      const value = es2f(valueStr);
      
      if (!currentStub.concepts[key]) {
        currentStub.concepts[key] = {
          code,
          name: desc.trim(),
          value: 0,
          type: 'RT'
        };
      }
      currentStub.concepts[key].value += value;
      continue;
    }
  }

  // Push final stub
  if (currentStub) {
    stubs.push(currentStub);
  }

  // Consolidate employees (an employee might have multiple stubs across different pages)
  const consolidatedMap: Record<string, EmployeeStub> = {};
  const orderedKeys: string[] = [];

  for (const stub of stubs) {
    const uKey = stub.name.toUpperCase().trim();
    if (!consolidatedMap[uKey]) {
      consolidatedMap[uKey] = {
        name: stub.name,
        concepts: {},
        liquido: 0
      };
      orderedKeys.push(uKey);
    }
    
    const target = consolidatedMap[uKey];
    target.liquido += stub.liquido;
    
    for (const [ckey, concept] of Object.entries(stub.concepts)) {
      if (!target.concepts[ckey]) {
        target.concepts[ckey] = { ...concept };
      } else {
        target.concepts[ckey].value += concept.value;
      }
    }
  }

  return orderedKeys.map(k => consolidatedMap[k]);
}

// Dummy helper variable for lines iterator
let rowIdx = 0;

/**
 * Parses Totrep/OP PDF to extract official totals and Net Liquido reported.
 */
export function parseTotrep(lines: string[]): { totalsReported: Record<string, number>; reportedLiquido: number } {
  const totalsReported: Record<string, number> = {};
  let reportedLiquido = 0;

  for (const line of lines) {
    if (!line) continue;
    const trimmed = line.trim();

    // Look for standard concept codes:
    // Format 1: "DV 1000003 Asignación Basica 4607257,86 0,00"
    // Format 2: "RT 660060 Aporte Personal Jubilatorio 0,00 3350392,50"
    // We match the type, code, and then extract the final numbers.
    const conceptMatch = trimmed.match(/^(DV|RT)\s+(\d+)\s+(.+)$/);
    if (conceptMatch) {
      const [, type, code, rest] = conceptMatch;
      const key = `${type}_${code}`;
      
      // Extract all numbers of Spanish decimal format at the end of the line
      const numMatches = rest.match(/([\d\.]+,\d{2})/g);
      if (numMatches && numMatches.length > 0) {
        if (numMatches.length >= 2) {
          const val1 = es2f(numMatches[numMatches.length - 2]);
          const val2 = es2f(numMatches[numMatches.length - 1]);
          
          if (type === 'DV') {
            // Usually Earnings column is first
            totalsReported[key] = val1 !== 0 ? val1 : val2;
          } else {
            // Deductions column is second
            totalsReported[key] = val2 !== 0 ? val2 : val1;
          }
        } else {
          totalsReported[key] = es2f(numMatches[0]);
        }
      }
      continue;
    }

    // Look for reported Net Pay (Lìquido a Pagar / Monto Total Liquido)
    const liqMatch = trimmed.match(/(?:Lìquido|Liquido)\s+a\s+Pagar:?\s*([\d\.]+,\d{2})/i) ||
                     trimmed.match(/Monto\s+Total\s+Liquido\s+por\s+Empresa:?\s*([\d\.]+,\d{2})/i) ||
                     trimmed.match(/Liquido\s+a\s+pagar:?\s*([\d\.]+,\d{2})/i);
    
    if (liqMatch) {
      reportedLiquido = es2f(liqMatch[1]);
    }
  }

  return { totalsReported, reportedLiquido };
}

/**
 * Validates stubs totals against reported summary totals.
 */
export function processAndCompare(
  employees: EmployeeStub[],
  totalsReported: Record<string, number>,
  reportedLiquido: number
): ProcessingResult {
  const conceptsMap: Record<string, { name: string; type: 'DV' | 'RT' }> = {};
  
  // Collect all unique concepts across all stubs and assign column names dynamically
  for (const emp of employees) {
    for (const [key, concept] of Object.entries(emp.concepts)) {
      if (!conceptsMap[key]) {
        conceptsMap[key] = {
          name: concept.name,
          type: concept.type
        };
      } else if (concept.name.length > conceptsMap[key].name.length) {
        // Prefer longer/more descriptive name if variations exist
        conceptsMap[key].name = concept.name;
      }
    }
  }

  const dvKeys = Object.keys(conceptsMap).filter(k => k.startsWith('DV_')).sort();
  const rtK = Object.keys(conceptsMap).filter(k => k.startsWith('RT_')).sort();

  // Aggregate sums from all stubs for each concept
  const calculatedSums: Record<string, number> = {};
  for (const emp of employees) {
    for (const [key, concept] of Object.entries(emp.concepts)) {
      calculatedSums[key] = (calculatedSums[key] || 0) + concept.value;
    }
  }

  // Sum total net pay from stubs
  const calculatedLiquido = employees.reduce((acc, emp) => acc + emp.liquido, 0);

  // Compare each concept
  const comparisons: ComparisonResult[] = [];
  const allConceptKeys = new Set([...Object.keys(calculatedSums), ...Object.keys(totalsReported)]);

  for (const key of allConceptKeys) {
    const calculated = calculatedSums[key] || 0;
    const reported = totalsReported[key] || 0;
    const difference = Math.abs(calculated - reported);
    
    const parts = key.split('_');
    const type = parts[0] as 'DV' | 'RT';
    const code = parts[1] || '';
    const name = conceptsMap[key]?.name || `Concepto ${code}`;

    // Discard tiny rounding differences less than 0.02
    if (difference > 0.02 || calculated > 0 || reported > 0) {
      comparisons.push({
        code,
        name,
        calculated,
        reported,
        difference: difference <= 0.02 ? 0 : difference,
        type
      });
    }
  }

  // Sort comparisons by type (DV then RT) and then by code
  comparisons.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'DV' ? -1 : 1;
    return a.code.localeCompare(b.code);
  });

  const liqDiff = Math.abs(calculatedLiquido - reportedLiquido);
  const hasDiscrepancies = comparisons.some(c => c.difference > 0.02) || (reportedLiquido > 0 && liqDiff > 0.02);

  return {
    employees,
    conceptsMap,
    dvKeys,
    rtK,
    totalsReported,
    reportedLiquido,
    calculatedLiquido,
    comparisons,
    hasDiscrepancies
  };
}
