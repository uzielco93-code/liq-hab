import { useState, useMemo, useRef, DragEvent, ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { 
  FileText, 
  UploadCloud, 
  CheckCircle2, 
  AlertTriangle, 
  Search, 
  FileSpreadsheet, 
  Play, 
  RefreshCw, 
  X, 
  Terminal, 
  ArrowUpDown, 
  Calculator, 
  Sparkles, 
  Activity, 
  DollarSign, 
  Layers, 
  Download,
  School,
  ArrowRight,
  Info
} from 'lucide-react';

import { EmployeeStub, ParsingLog, ProcessingResult, ComparisonResult } from './types';
import { extractPdfLines, parseEmployeeReceipts, parseTotrep, processAndCompare, es2f } from './utils/parser';

export default function App() {
  // Files State
  const [recibosFile, setRecibosFile] = useState<File | null>(null);
  const [totrepFile, setTotrepFile] = useState<File | null>(null);
  const [opFile, setOpFile] = useState<File | null>(null);

  // Drag over states
  const [isDragRec, setIsDragRec] = useState(false);
  const [isDragTot, setIsDragTot] = useState(false);
  const [isDragOp, setIsDragOp] = useState(false);

  // Processing State
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<ParsingLog[]>([]);
  const [result, setResult] = useState<ProcessingResult | null>(null);

  // UI State
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'table' | 'validation' | 'logs'>('table');
  const [sortField, setSortField] = useState<string>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Input refs for manual selection
  const refRec = useRef<HTMLInputElement>(null);
  const refTot = useRef<HTMLInputElement>(null);
  const refOp = useRef<HTMLInputElement>(null);

  // Log logger helper
  const addLog = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const newLog: ParsingLog = {
      id: Math.random().toString(36).substring(2, 9),
      message,
      type,
      timestamp: new Date().toLocaleTimeString()
    };
    setLogs(prev => [...prev, newLog]);
  };

  // Drag-and-drop handler builders
  const createDragHandlers = (
    setDrag: (val: boolean) => void,
    setFile: (file: File) => void,
    inputId: string
  ) => {
    return {
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        setDrag(true);
      },
      onDragLeave: () => {
        setDrag(false);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setDrag(false);
        const file = e.dataTransfer.files[0];
        if (file && file.name.toLowerCase().endsWith('.pdf')) {
          setFile(file);
          addLog(`Archivo detectado por arrastre: "${file.name}"`, 'success');
        } else {
          addLog('Formato incorrecto. Por favor, suba únicamente archivos PDF.', 'error');
        }
      }
    };
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>, setFile: (file: File) => void) => {
    const file = e.target.files?.[0];
    if (file) {
      setFile(file);
      addLog(`Archivo seleccionado: "${file.name}" (${(file.size / 1024).toFixed(1)} KB)`, 'success');
    }
  };

  // Reset to initial state
  const handleReset = () => {
    setRecibosFile(null);
    setTotrepFile(null);
    setOpFile(null);
    setResult(null);
    setProgress(0);
    setLogs([]);
    setSearchTerm('');
    setActiveTab('table');
  };

  // Core processing orchestration
  const handleProcess = async () => {
    if (!recibosFile || !totrepFile) return;

    setIsProcessing(true);
    setProgress(10);
    setLogs([]);
    setResult(null);

    addLog('Iniciando extracción y validación de liquidación de haberes...', 'info');

    try {
      // Step 1: Parse Recibos PDF
      addLog('Analizando archivo de recibos individuales...', 'info');
      setProgress(20);
      const rLines = await extractPdfLines(recibosFile, (curr, total) => {
        setProgress(Math.round(20 + (curr / total) * 30));
      });
      addLog(`Extracción de texto finalizada: ${rLines.length} líneas recuperadas de los recibos.`, 'success');

      // Step 2: Parse Receipts Data
      addLog('Procesando recibos individuales y extrayendo conceptos remunerativos y descuentos...', 'info');
      const employees = parseEmployeeReceipts(rLines, addLog);
      addLog(`Procesados ${employees.length} empleados únicos a partir de los recibos individuales.`, 'success');

      // Step 3: Parse Totrep Summary PDF
      addLog('Analizando archivo de totales por repartición (TOTREP)...', 'info');
      setProgress(60);
      const tLines = await extractPdfLines(totrepFile, (curr, total) => {
        setProgress(Math.round(60 + (curr / total) * 20));
      });
      addLog(`Extracción finalizada: ${tLines.length} líneas recuperadas de TOTREP.`, 'success');

      const { totalsReported, reportedLiquido } = parseTotrep(tLines);
      addLog(`Totales de control TOTREP recuperados: ${Object.keys(totalsReported).length} conceptos oficiales.`, 'success');

      // Process OpFile if uploaded
      let additionalReportedTotals = { ...totalsReported };
      let finalReportedLiquido = reportedLiquido;

      if (opFile) {
        addLog('Analizando archivo opcional de Orden de Pago...', 'info');
        const opLines = await extractPdfLines(opFile);
        const opData = parseTotrep(opLines);
        
        // Merge or replace totals
        additionalReportedTotals = { ...additionalReportedTotals, ...opData.totalsReported };
        if (opData.reportedLiquido > 0) {
          finalReportedLiquido = opData.reportedLiquido;
        }
        addLog('Conceptos e importes de Orden de Pago combinados con éxito.', 'success');
      }

      // Step 4: Perform comparison & audit checks
      setProgress(90);
      addLog('Validando sumas de recibos contra importes consolidados de TOTREP...', 'info');
      const results = processAndCompare(employees, additionalReportedTotals, finalReportedLiquido);

      setProgress(100);
      setResult(results);
      
      if (results.hasDiscrepancies) {
        addLog('Validación finalizada con ADVERTENCIAS: Se detectaron discrepancias entre los recibos individuales y el reporte TOTREP.', 'warning');
      } else {
        addLog('Validación finalizada con ÉXITO: Todos los totales y el neto líquido coinciden perfectamente con el resumen TOTREP.', 'success');
      }

    } catch (error: any) {
      addLog(`Fallo en el procesamiento: ${error.message || error}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Sort and filter logic
  const handleSort = (field: string) => {
    if (sortField === keyField(field)) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const filteredAndSortedEmployees = useMemo(() => {
    if (!result) return [];
    
    // 1. Filter
    const filtered = result.employees.filter(emp => 
      emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emp.idHr && emp.idHr.includes(searchTerm))
    );

    // 2. Sort
    return filtered.sort((a, b) => {
      let valA: any;
      let valB: any;

      if (sortField === 'name') {
        valA = a.name;
        valB = b.name;
        return sortDirection === 'asc' 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      } else if (sortField === 'idHr') {
        valA = a.idHr || '';
        valB = b.idHr || '';
        return sortDirection === 'asc'
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      } else if (sortField === 'liquido') {
        valA = a.liquido;
        valB = b.liquido;
      } else {
        // Concept code sort
        valA = a.concepts[sortField]?.value || 0;
        valB = b.concepts[sortField]?.value || 0;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [result, searchTerm, sortField, sortDirection]);

  // Export fully-formatted Excel workbook
  const handleExportExcel = () => {
    if (!result) return;
    const { employees, dvKeys, rtK, conceptsMap } = result;

    // Sheet 1: Detailed matrix (AOA format)
    const rows: any[][] = [];
    
    // Header Row 1: Merged Categories
    const h1 = ['Id. Hr', 'Información de Empleado'];
    dvKeys.forEach((_, idx) => h1.push(idx === 0 ? 'HABERES / DEVENGADOS (DV)' : ''));
    rtK.forEach((_, idx) => h1.push(idx === 0 ? 'DESCUENTOS / RETENCIONES (RT)' : ''));
    h1.push(''); // Liquido column
    rows.push(h1);

    // Header Row 2: Concept names
    const h2 = ['Id. Hr', 'Apellido y Nombre'];
    dvKeys.forEach(k => h2.push(conceptsMap[k]?.name || k));
    rtK.forEach(k => h2.push(conceptsMap[k]?.name || k));
    h2.push('Líquido a Pagar');
    rows.push(h2);

    // Data rows
    for (const emp of employees) {
      const row: any[] = [emp.idHr || '', emp.name];
      dvKeys.forEach(k => row.push(emp.concepts[k]?.value || null));
      rtK.forEach(k => row.push(emp.concepts[k]?.value || null));
      row.push(emp.liquido || null);
      rows.push(row);
    }

    // Totals row
    const totRow = ['', 'TOTALES'];
    dvKeys.forEach(k => {
      const tot = employees.reduce((s, e) => s + (e.concepts[k]?.value || 0), 0);
      totRow.push(tot || null);
    });
    rtK.forEach(k => {
      const tot = employees.reduce((s, e) => s + (e.concepts[k]?.value || 0), 0);
      totRow.push(tot || null);
    });
    totRow.push(employees.reduce((acc, emp) => acc + emp.liquido, 0));
    rows.push(totRow);

    // Create Sheet 1
    const ws1 = XLSX.utils.aoa_to_sheet(rows);
    
    // Set auto widths
    const colWidths = [
      { wch: 15 }, // Id. Hr column
      { wch: 32 }  // Name column
    ];
    [...dvKeys, ...rtK].forEach(() => colWidths.push({ wch: 18 }));
    colWidths.push({ wch: 22 }); // Liquido column
    ws1['!cols'] = colWidths;

    // Apply currency formatting to numeric columns
    for (let r = 2; r < rows.length; r++) {
      for (let c = 2; c < rows[r].length; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ws1[ref] && ws1[ref].v !== null && ws1[ref].v !== undefined) {
          ws1[ref].z = '#,##0.00';
        }
      }
    }

    // Sheet 2: Validation Audit Trail
    const valRows: any[][] = [
      ['CONTROL Y CONCILIACIÓN DE TOTALES'],
      [],
      ['Código', 'Concepto', 'Tipo', 'Calculado (Recibos)', 'Reportado (TOTREP)', 'Diferencia', 'Estado']
    ];

    for (const comp of result.comparisons) {
      const diffStatus = comp.difference > 0.02 ? 'Diferencia' : 'OK';
      valRows.push([
        comp.code,
        comp.name,
        comp.type === 'DV' ? 'Haber (DV)' : 'Descuento (RT)',
        comp.calculated,
        comp.reported,
        comp.difference,
        diffStatus
      ]);
    }

    // Add Liquido comparison to sheet 2
    const netDiff = Math.abs(result.calculatedLiquido - result.reportedLiquido);
    valRows.push([]);
    valRows.push([
      'NETO',
      'LÍQUIDO NETO A PAGAR',
      'Neto',
      result.calculatedLiquido,
      result.reportedLiquido,
      netDiff,
      netDiff > 0.02 ? 'Diferencia' : 'OK'
    ]);

    const ws2 = XLSX.utils.aoa_to_sheet(valRows);
    ws2['!cols'] = [
      { wch: 12 }, // Code
      { wch: 35 }, // Name
      { wch: 15 }, // Type
      { wch: 20 }, // Calculated
      { wch: 20 }, // Reported
      { wch: 15 }, // Difference
      { wch: 15 }  // Status
    ];

    // Format numbers in sheet 2
    for (let r = 3; r < valRows.length; r++) {
      if (valRows[r].length < 5) continue; // Skip empty row
      for (const colIdx of [3, 4, 5]) {
        const ref = XLSX.utils.encode_cell({ r, c: colIdx });
        if (ws2[ref] && ws2[ref].v !== null && ws2[ref].v !== undefined) {
          ws2[ref].z = '#,##0.00';
        }
      }
    }

    // Sheet 3: Consolidated Summary per Employee
    const summaryRows: any[][] = [
      ['RESUMEN CONSOLIDADO POR EMPLEADO'],
      [],
      ['Id. Hr', 'Apellido y Nombre', 'Rem. c/ Aporte', 'Rem. s/ Aporte (restado S.F.)', 'Salario Familiar', 'Descuentos', 'Líquido a Pagar']
    ];

    for (const emp of employees) {
      summaryRows.push([
        emp.idHr || '',
        emp.name,
        emp.remCAporte || 0,
        Math.max(0, (emp.remSAporte || 0) - (emp.salarioFamiliar || 0)),
        emp.salarioFamiliar || 0,
        emp.totalDescuentos || 0,
        emp.liquido || 0
      ]);
    }

    // Totals row for Sheet 3
    const totalRemCAporte = employees.reduce((s, e) => s + (e.remCAporte || 0), 0);
    const totalRemSAporteRestado = employees.reduce((s, e) => s + Math.max(0, (e.remSAporte || 0) - (e.salarioFamiliar || 0)), 0);
    const totalSalarioFamiliar = employees.reduce((s, e) => s + (e.salarioFamiliar || 0), 0);
    const totalDescuentos = employees.reduce((s, e) => s + (e.totalDescuentos || 0), 0);
    const totalLiquido = employees.reduce((s, e) => s + (e.liquido || 0), 0);

    summaryRows.push([
      '',
      'TOTALES',
      totalRemCAporte,
      totalRemSAporteRestado,
      totalSalarioFamiliar,
      totalDescuentos,
      totalLiquido
    ]);

    const ws3 = XLSX.utils.aoa_to_sheet(summaryRows);
    ws3['!cols'] = [
      { wch: 15 }, // Id. Hr
      { wch: 32 }, // Name
      { wch: 20 }, // Rem con aporte
      { wch: 28 }, // Rem sin aporte (restado S.F.)
      { wch: 20 }, // Salario familiar
      { wch: 18 }, // Descuentos
      { wch: 22 }  // Liquido
    ];

    // Format numbers in sheet 3
    for (let r = 3; r < summaryRows.length; r++) {
      for (const colIdx of [2, 3, 4, 5, 6]) {
        const ref = XLSX.utils.encode_cell({ r, c: colIdx });
        if (ws3[ref] && ws3[ref].v !== null && ws3[ref].v !== undefined) {
          ws3[ref].z = '#,##0.00';
        }
      }
    }

    // Build workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Matriz de Liquidación');
    XLSX.utils.book_append_sheet(wb, ws3, 'Resumen Consolidado');
    XLSX.utils.book_append_sheet(wb, ws2, 'Conciliación de Totales');

    // Generate output file
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `Liquidacion_Haberes_${dateStr}.xlsx`;
    XLSX.writeFile(wb, filename);
    addLog(`✓ Excel generado correctamente: "${filename}"`, 'success');
  };

  const keyField = (name: string) => {
    return name;
  };

  return (
    <div className="min-height-screen flex flex-col font-sans">
      {/* Dynamic Header */}
      <header className="border-b border-slate-800 bg-[#0f1424] px-6 py-5 shadow-lg">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-500 to-emerald-400 font-bold shadow-indigo-500/20 shadow-lg text-lg">
              📊
            </div>
            <div>
              <h1 className="font-mono text-base font-semibold tracking-wider text-white">
                LIQUIDACIÓN DE HABERES
              </h1>
              <p className="text-xs text-slate-400">
                Conciliador Inteligente de PDF para Escuelas y Periodos Dinámicos
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
              Motor Activo · V2.5
            </span>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="mx-auto w-full max-w-7xl flex-1 p-6 md:p-8">
        
        {/* Step 1: Upload Workspace */}
        {!result && !isProcessing && (
          <div className="space-y-8 animate-fade-in">
            {/* Context Notice banner */}
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-505/5 p-4 text-slate-300 shadow-sm flex items-start gap-3 bg-[#11172a]">
              <Info className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed space-y-1">
                <p className="font-semibold text-white">Procesamiento Automatizado Multi-Escuela y Flexible</p>
                <p>
                  Sube los recibos individuales y el resumen de totales. El sistema detectará automáticamente todos los conceptos, sumará los valores duplicados por empleado y cruzará los importes finales contra los totales declarados. Al basarse en códigos de conceptos, es resistente a variaciones en los nombres o nuevas columnas.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {/* Dropzone: Receipts (Required) */}
              <div 
                {...createDragHandlers(setIsDragRec, setRecibosFile, 'file-rec')}
                onClick={() => refRec.current?.click()}
                className={`group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-300 bg-[#0f1424] ${
                  recibosFile 
                    ? 'border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10' 
                    : isDragRec 
                      ? 'border-indigo-500 bg-indigo-500/10 scale-[1.02]' 
                      : 'border-slate-800 hover:border-indigo-500/50 hover:bg-slate-850/50'
                }`}
              >
                <input 
                  type="file" 
                  ref={refRec} 
                  id="file-rec" 
                  accept=".pdf" 
                  className="hidden" 
                  onChange={(e) => handleFileChange(e, setRecibosFile)} 
                />
                <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full transition-all duration-300 ${
                  recibosFile ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400 group-hover:bg-indigo-500/20 group-hover:text-indigo-400'
                }`}>
                  <FileText className="h-7 w-7" />
                </div>
                <h3 className="font-mono text-xs font-semibold tracking-wider text-slate-200 uppercase">
                  Recibos Individuales
                </h3>
                <p className="mt-2 text-xs text-slate-400 leading-normal">
                  PDF con recibos por agente (Ej: LIQHAB_...pdf)
                </p>
                {recibosFile ? (
                  <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400 font-mono break-all max-w-full">
                    ✓ {recibosFile.name}
                  </div>
                ) : (
                  <span className="mt-4 text-xs font-semibold text-indigo-400 group-hover:underline">
                    Seleccionar o soltar archivo
                  </span>
                )}
              </div>

              {/* Dropzone: Totrep Summary (Required) */}
              <div 
                {...createDragHandlers(setIsDragTot, setTotrepFile, 'file-tot')}
                onClick={() => refTot.current?.click()}
                className={`group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-300 bg-[#0f1424] ${
                  totrepFile 
                    ? 'border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10' 
                    : isDragTot 
                      ? 'border-indigo-500 bg-indigo-500/10 scale-[1.02]' 
                      : 'border-slate-800 hover:border-indigo-500/50 hover:bg-slate-850/50'
                }`}
              >
                <input 
                  type="file" 
                  ref={refTot} 
                  id="file-tot" 
                  accept=".pdf" 
                  className="hidden" 
                  onChange={(e) => handleFileChange(e, setTotrepFile)} 
                />
                <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full transition-all duration-300 ${
                  totrepFile ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400 group-hover:bg-indigo-500/20 group-hover:text-indigo-400'
                }`}>
                  <Layers className="h-7 w-7" />
                </div>
                <h3 className="font-mono text-xs font-semibold tracking-wider text-slate-200 uppercase">
                  Total por Repartición (TOTREP)
                </h3>
                <p className="mt-2 text-xs text-slate-400 leading-normal">
                  PDF de totales agrupados (Ej: TOTREP_...pdf)
                </p>
                {totrepFile ? (
                  <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400 font-mono break-all max-w-full">
                    ✓ {totrepFile.name}
                  </div>
                ) : (
                  <span className="mt-4 text-xs font-semibold text-indigo-400 group-hover:underline">
                    Seleccionar o soltar archivo
                  </span>
                )}
              </div>

              {/* Dropzone: Orden de Pago (Optional) */}
              <div 
                {...createDragHandlers(setIsDragOp, setOpFile, 'file-op')}
                onClick={() => refOp.current?.click()}
                className={`group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-300 bg-[#0f1424] ${
                  opFile 
                    ? 'border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10' 
                    : isDragOp 
                      ? 'border-indigo-500 bg-indigo-500/10 scale-[1.02]' 
                      : 'border-slate-800 hover:border-indigo-500/50 hover:bg-slate-850/50'
                }`}
              >
                <input 
                  type="file" 
                  ref={refOp} 
                  id="file-op" 
                  accept=".pdf" 
                  className="hidden" 
                  onChange={(e) => handleFileChange(e, setOpFile)} 
                />
                <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full transition-all duration-300 ${
                  opFile ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400 group-hover:bg-indigo-500/20 group-hover:text-indigo-400'
                }`}>
                  <Calculator className="h-7 w-7" />
                </div>
                <h3 className="font-mono text-xs font-semibold tracking-wider text-slate-200 uppercase">
                  Orden de Pago (Opcional)
                </h3>
                <p className="mt-2 text-xs text-slate-400 leading-normal">
                  PDF complementario de control final (Ej: OP_...pdf)
                </p>
                {opFile ? (
                  <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400 font-mono break-all max-w-full">
                    ✓ {opFile.name}
                  </div>
                ) : (
                  <span className="mt-4 text-xs font-semibold text-slate-400 group-hover:underline">
                    Subir orden (opcional)
                  </span>
                )}
              </div>
            </div>

            {/* Launch action bar */}
            <div className="flex justify-center pt-4">
              <button
                onClick={handleProcess}
                disabled={!recibosFile || !totrepFile}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:from-slate-800 disabled:to-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white px-8 py-4 font-mono text-sm font-semibold tracking-wider shadow-lg hover:shadow-indigo-500/10 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 w-full md:w-auto justify-center"
              >
                <Play className="h-4 w-4 fill-white" />
                PROCESAR Y VERIFICAR TOTALES
              </button>
            </div>
          </div>
        )}

        {/* Processing View */}
        {isProcessing && (
          <div className="flex flex-col items-center justify-center py-16 space-y-6 animate-pulse">
            <RefreshCw className="h-12 w-12 text-indigo-500 animate-spin" />
            <div className="text-center">
              <h3 className="text-lg font-semibold text-white">Extrayendo datos de los PDF...</h3>
              <p className="text-sm text-slate-400 mt-1">Este proceso toma unos segundos y corre localmente en su navegador</p>
            </div>
            <div className="w-full max-w-md bg-slate-800 rounded-full h-2.5">
              <div 
                className="bg-indigo-500 h-2.5 rounded-full transition-all duration-300" 
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <span className="text-xs font-mono text-indigo-400 font-semibold">{progress}% Completado</span>
          </div>
        )}

        {/* Step 2: Processing Complete - Summary Panel */}
        {result && (
          <div className="space-y-8 animate-fade-in">
            {/* Validation Banner Alert */}
            {result.hasDiscrepancies ? (
              <div className="rounded-2xl border-2 border-rose-500/20 bg-rose-500/10 p-5 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 text-rose-400">
                    <AlertTriangle className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Se detectaron diferencias</h3>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      El monto consolidado sumando los recibos individuales difiere de los reportado en el resumen general de TOTREP. Revise la pestaña de <b>"Verificación de Totales"</b> para identificar los conceptos con diferencias.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setActiveTab('validation')}
                    className="rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs px-4 py-2 font-semibold font-mono tracking-wide transition-all border border-rose-500/30"
                  >
                    Ver Diferencias
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-emerald-500/20 bg-emerald-500/10 p-5 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                    <CheckCircle2 className="h-6 w-6 animate-bounce" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Validación Perfecta</h3>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      ¡Felicidades! Todos los conceptos procesados de los recibos de los agentes coinciden exactamente con los totales globales informados en el resumen TOTREP.
                    </p>
                  </div>
                </div>
                <button 
                  onClick={handleExportExcel}
                  className="flex items-center gap-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-900 text-xs px-5 py-2.5 font-bold font-mono tracking-wide transition-all"
                >
                  <Download className="h-4 w-4" />
                  DESCARGAR EXCEL COMPLETO
                </button>
              </div>
            )}

            {/* Metrics cards grid */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-xl bg-[#0f1424] border border-slate-800 p-4 shadow-md flex flex-col justify-between">
                <span className="text-xs text-slate-400 font-mono tracking-wider uppercase">Calculado Recibos</span>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-lg font-bold text-indigo-400 font-mono">
                    ${result.calculatedLiquido.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1 font-mono">Sumatoria de recibos</div>
              </div>

              <div className="rounded-xl bg-[#0f1424] border border-slate-800 p-4 shadow-md flex flex-col justify-between">
                <span className="text-xs text-slate-400 font-mono tracking-wider uppercase">Reportado TOTREP</span>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-lg font-bold text-white font-mono">
                    ${result.reportedLiquido.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1 font-mono">Importe global declarado</div>
              </div>

              <div className="rounded-xl bg-[#0f1424] border border-slate-800 p-4 shadow-md flex flex-col justify-between">
                <span className="text-xs text-slate-400 font-mono tracking-wider uppercase">Líquido Neto</span>
                <div className="mt-2 flex items-center gap-1.5">
                  {Math.abs(result.calculatedLiquido - result.reportedLiquido) <= 0.02 ? (
                    <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-xs font-mono text-emerald-400 font-semibold">
                      ✓ Conciliado
                    </span>
                  ) : (
                    <span className="rounded-full bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 text-xs font-mono text-rose-400 font-semibold">
                      Dif: ${(Math.abs(result.calculatedLiquido - result.reportedLiquido)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 mt-1 font-mono">Estado de Neto Líquido</div>
              </div>

              <div className="rounded-xl bg-[#0f1424] border border-slate-800 p-4 shadow-md flex flex-col justify-between">
                <span className="text-xs text-slate-400 font-mono tracking-wider uppercase">Agentes Procesados</span>
                <span className="text-2xl font-black text-white mt-2 font-mono">{result.employees.length}</span>
                <div className="text-[10px] text-slate-400 mt-1 font-mono">Agentes únicos consolidados</div>
              </div>

              <div className="rounded-xl bg-[#0f1424] border border-slate-800 p-4 shadow-md flex flex-col justify-between col-span-2 lg:col-span-1">
                <span className="text-xs text-slate-400 font-mono tracking-wider uppercase">Conceptos Totales</span>
                <span className="text-2xl font-black text-white mt-2 font-mono">
                  {result.dvKeys.length + result.rtK.length}
                </span>
                <div className="text-[10px] text-indigo-400 mt-1 font-mono">
                  {result.dvKeys.length} Haberes / {result.rtK.length} Dctos
                </div>
              </div>
            </div>

            {/* Results views tabs controller */}
            <div className="border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setActiveTab('table')}
                  className={`border-b-2 px-4 py-3 font-mono text-xs tracking-wider font-semibold transition-all duration-200 ${
                    activeTab === 'table' 
                      ? 'border-indigo-500 text-indigo-400' 
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  📋 Matriz de Haberes
                </button>
                <button
                  onClick={() => setActiveTab('validation')}
                  className={`border-b-2 px-4 py-3 font-mono text-xs tracking-wider font-semibold transition-all duration-200 flex items-center gap-1.5 ${
                    activeTab === 'validation' 
                      ? 'border-indigo-500 text-indigo-400' 
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  🔍 Verificación de Totales
                  {result.hasDiscrepancies && (
                    <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping"></span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('logs')}
                  className={`border-b-2 px-4 py-3 font-mono text-xs tracking-wider font-semibold transition-all duration-200 ${
                    activeTab === 'logs' 
                      ? 'border-indigo-500 text-indigo-400' 
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  💻 Log de Extracción
                </button>
              </div>

              <div className="flex gap-2 mb-2">
                <button
                  onClick={handleExportExcel}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-400 border border-indigo-500/20 text-xs px-4 py-2 font-bold font-mono tracking-wide transition-all"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Exportar a Excel
                </button>
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-4 py-2 font-bold font-mono tracking-wide transition-all"
                >
                  <RefreshCw className="h-4 w-4" />
                  Cargar Nuevos PDFs
                </button>
              </div>
            </div>

            {/* TAB 1: Main dynamic preview spreadsheet matrix */}
            {activeTab === 'table' && (
              <div className="space-y-4 animate-fade-in">
                {/* Search and control bar */}
                <div className="flex items-center gap-3 bg-[#0f1424] border border-slate-800 rounded-xl px-4 py-3 max-w-md">
                  <Search className="h-4 w-4 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Filtrar agentes por nombre..."
                    className="bg-transparent border-none text-xs text-white placeholder-slate-500 outline-none w-full"
                  />
                  {searchTerm && (
                    <button onClick={() => setSearchTerm('')} className="text-slate-500 hover:text-white">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Big Matrix Table wrapping */}
                <div className="border border-slate-800 rounded-xl overflow-hidden shadow-lg bg-[#0c1020]">
                  <div className="overflow-x-auto max-h-[500px]">
                    <table className="w-full border-collapse font-mono text-[11px] text-right">
                      <thead className="sticky top-0 z-20">
                        {/* Header Row 1: High level groups */}
                        <tr className="bg-[#090d19] border-b border-slate-800 text-[10px] text-slate-400 font-semibold tracking-wider text-center">
                          <th className="sticky left-0 bg-[#090d19] z-30 text-left border-r border-slate-800 px-4 py-2.5 min-w-[100px]">
                            ID. HR
                          </th>
                          <th className="sticky left-[100px] bg-[#090d19] z-30 text-left border-r border-slate-800 px-4 py-2.5 min-w-[220px]">
                            EMPLEADO
                          </th>
                          <th 
                            colSpan={result.dvKeys.length || 1} 
                            className="border-r border-slate-800 px-4 py-2 text-indigo-400"
                          >
                            HABERES / DEVENGADOS (DV)
                          </th>
                          <th 
                            colSpan={result.rtK.length || 1} 
                            className="border-r border-slate-800 px-4 py-2 text-amber-500"
                          >
                            DESCUENTOS / RETENCIONES (RT)
                          </th>
                          <th className="px-4 py-2 text-emerald-400">
                            LÍQUIDO
                          </th>
                        </tr>

                        {/* Header Row 2: Sub columns / concept names */}
                        <tr className="bg-[#12182c] border-b border-slate-800 text-slate-350">
                          <th 
                            onClick={() => handleSort('idHr')}
                            className="sticky left-0 bg-[#12182c] z-30 text-left border-r border-slate-800 px-4 py-3 min-w-[100px] font-semibold text-white cursor-pointer hover:bg-slate-850 flex items-center justify-between"
                          >
                            <span>Id. Hr</span>
                            <ArrowUpDown className="h-3 w-3 text-slate-500" />
                          </th>
                          <th 
                            onClick={() => handleSort('name')}
                            className="sticky left-[100px] bg-[#12182c] z-30 text-left border-r border-slate-800 px-4 py-3 min-w-[220px] font-semibold text-white cursor-pointer hover:bg-slate-850 flex items-center justify-between"
                          >
                            <span>Apellido y Nombre</span>
                            <ArrowUpDown className="h-3 w-3 text-slate-500" />
                          </th>
                          
                          {/* Haberes */}
                          {result.dvKeys.map(k => (
                            <th 
                              key={k}
                              onClick={() => handleSort(k)}
                              className="px-4 py-3 border-r border-slate-800/50 cursor-pointer hover:bg-slate-850 whitespace-nowrap text-xs font-semibold text-slate-200"
                              title={`${k}: ${result.conceptsMap[k].name}`}
                            >
                              <div className="max-w-[120px] truncate" title={`${k}: ${result.conceptsMap[k].name}`}>
                                {result.conceptsMap[k].name}
                              </div>
                            </th>
                          ))}

                          {/* Descuentos */}
                          {result.rtK.map(k => (
                            <th 
                              key={k}
                              onClick={() => handleSort(k)}
                              className="px-4 py-3 border-r border-slate-800/50 cursor-pointer hover:bg-slate-850 whitespace-nowrap text-xs font-semibold text-slate-200"
                              title={`${k}: ${result.conceptsMap[k].name}`}
                            >
                              <div className="max-w-[120px] truncate" title={`${k}: ${result.conceptsMap[k].name}`}>
                                {result.conceptsMap[k].name}
                              </div>
                            </th>
                          ))}

                          {/* Neto */}
                          <th 
                            onClick={() => handleSort('liquido')}
                            className="px-4 py-3 font-semibold text-emerald-400 cursor-pointer hover:bg-slate-850 text-right min-w-[110px]"
                          >
                            <div className="flex items-center justify-end gap-1">
                              <span>Neto</span>
                              <ArrowUpDown className="h-3 w-3" />
                            </div>
                          </th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-800/40">
                        {filteredAndSortedEmployees.map((emp) => (
                          <tr key={emp.name} className="hover:bg-indigo-950/20 transition-all">
                            {/* Id. Hr sticky */}
                            <td 
                              className="sticky left-0 bg-[#0c1020] border-r border-slate-800 px-4 py-2 text-left font-mono text-slate-400 whitespace-nowrap min-w-[100px] truncate"
                              title={emp.idHr}
                            >
                              {emp.idHr || '-'}
                            </td>
                            {/* Employee name sticky */}
                            <td 
                              className="sticky left-[100px] bg-[#0c1020] border-r border-slate-800 px-4 py-2 text-left font-semibold text-white whitespace-nowrap min-w-[220px] truncate" 
                              title={emp.name}
                            >
                              {emp.name}
                            </td>

                            {/* DV values */}
                            {result.dvKeys.map(k => {
                              const val = emp.concepts[k]?.value;
                              return (
                                <td key={k} className="px-4 py-2 border-r border-slate-800/30 text-indigo-300 font-medium">
                                  {val ? val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                                </td>
                              );
                            })}

                            {/* RT values */}
                            {result.rtK.map(k => {
                              const val = emp.concepts[k]?.value;
                              return (
                                <td key={k} className="px-4 py-2 border-r border-slate-800/30 text-amber-300/90 font-medium">
                                  {val ? val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                                </td>
                              );
                            })}

                            {/* Liquido Net */}
                            <td className="px-4 py-2 font-bold text-emerald-400 bg-emerald-950/5 font-mono">
                              ${emp.liquido.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>

                      {/* Grand Totals Row */}
                      <tfoot className="border-t-2 border-slate-800">
                        <tr className="bg-[#0b1022] font-bold text-white text-right">
                          <td className="sticky left-0 bg-[#0b1022] border-r border-slate-800 px-4 py-3 text-left font-mono text-slate-500">
                            -
                          </td>
                          <td className="sticky left-[100px] bg-[#0b1022] border-r border-slate-800 px-4 py-3 text-left font-bold text-indigo-400">
                            TOTALES
                          </td>

                          {result.dvKeys.map(k => {
                            const tot = result.employees.reduce((s, e) => s + (e.concepts[k]?.value || 0), 0);
                            return (
                              <td key={k} className="px-4 py-3 border-r border-slate-800/50 text-indigo-400">
                                {tot > 0 ? tot.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                              </td>
                            );
                          })}

                          {result.rtK.map(k => {
                            const tot = result.employees.reduce((s, e) => s + (e.concepts[k]?.value || 0), 0);
                            return (
                              <td key={k} className="px-4 py-3 border-r border-slate-800/50 text-amber-500">
                                {tot > 0 ? tot.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                              </td>
                            );
                          })}

                          <td className="px-4 py-3 font-extrabold text-emerald-400 bg-[#0d162c] text-right">
                            ${result.employees.reduce((s, e) => s + e.liquido, 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* Consolidated Summary Table Section */}
                <div className="mt-8 rounded-xl border border-slate-800 bg-[#0a0d18] overflow-hidden p-6 space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
                      Resumen Consolidado de Conceptos Críticos por Agente
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 leading-normal">
                      Vista simplificada con las métricas de haberes previsionales, no previsionales (excluyendo salario familiar), asignaciones familiares, deducciones totales y haberes netos a cobrar.
                    </p>
                  </div>

                  <div className="border border-slate-800 rounded-xl overflow-hidden bg-[#0c1020]">
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse font-mono text-[11px] text-right">
                        <thead>
                          <tr className="bg-[#12182c] border-b border-slate-800 text-slate-300 font-semibold">
                            <th className="text-left px-4 py-3 min-w-[100px] border-r border-slate-800">Id. Hr</th>
                            <th className="text-left px-4 py-3 min-w-[220px] border-r border-slate-800">Apellido y Nombre</th>
                            <th className="px-4 py-3 border-r border-slate-800">Rem. c/ Aporte</th>
                            <th className="px-4 py-3 border-r border-slate-800">Rem. s/ Aporte (restado S.F.)</th>
                            <th className="px-4 py-3 border-r border-slate-800">Salario Familiar</th>
                            <th className="px-4 py-3 border-r border-slate-800">Descuentos</th>
                            <th className="px-4 py-3 text-emerald-400">Líquido a Pagar</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/40">
                          {filteredAndSortedEmployees.map((emp) => {
                            const remCAporte = emp.remCAporte || 0;
                            const salarioFam = emp.salarioFamiliar || 0;
                            const remSAporteRestado = Math.max(0, (emp.remSAporte || 0) - salarioFam);
                            const descuentos = emp.totalDescuentos || 0;
                            const liquido = emp.liquido || 0;

                            return (
                              <tr key={`sum-${emp.name}`} className="hover:bg-indigo-950/20 transition-all">
                                <td className="text-left px-4 py-2 border-r border-slate-800 text-slate-400 font-mono">
                                  {emp.idHr || '-'}
                                </td>
                                <td className="text-left px-4 py-2 border-r border-slate-800 font-semibold text-white whitespace-nowrap truncate max-w-[240px]" title={emp.name}>
                                  {emp.name}
                                </td>
                                <td className="px-4 py-2 border-r border-slate-800/30 text-indigo-300">
                                  {remCAporte > 0 ? remCAporte.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                                </td>
                                <td className="px-4 py-2 border-r border-slate-800/30 text-sky-300">
                                  {remSAporteRestado > 0 ? remSAporteRestado.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                                </td>
                                <td className="px-4 py-2 border-r border-slate-800/30 text-amber-300/90">
                                  {salarioFam > 0 ? salarioFam.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                                </td>
                                <td className="px-4 py-2 border-r border-slate-800/30 text-rose-300/90">
                                  {descuentos > 0 ? descuentos.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                                </td>
                                <td className="px-4 py-2 font-bold text-emerald-400 bg-emerald-950/5">
                                  ${liquido.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="border-t-2 border-slate-800">
                          <tr className="bg-[#0b1022] font-bold text-white text-right">
                            <td className="text-left px-4 py-3 border-r border-slate-800">-</td>
                            <td className="text-left px-4 py-3 border-r border-slate-800 text-indigo-400 font-bold">TOTALES</td>
                            <td className="px-4 py-3 border-r border-slate-800/50 text-indigo-400">
                              {filteredAndSortedEmployees.reduce((s, e) => s + (e.remCAporte || 0), 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-3 border-r border-slate-800/50 text-sky-400">
                              {filteredAndSortedEmployees.reduce((s, e) => s + Math.max(0, (e.remSAporte || 0) - (e.salarioFamiliar || 0)), 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-3 border-r border-slate-800/50 text-amber-400">
                              {filteredAndSortedEmployees.reduce((s, e) => s + (e.salarioFamiliar || 0), 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-3 border-r border-slate-800/50 text-rose-400">
                              {filteredAndSortedEmployees.reduce((s, e) => s + (e.totalDescuentos || 0), 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-3 font-extrabold text-emerald-400 bg-[#0d162c]">
                              ${filteredAndSortedEmployees.reduce((s, e) => s + e.liquido, 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Audit Comparison Report view */}
            {activeTab === 'validation' && (
              <div className="space-y-6 animate-fade-in">
                <div className="rounded-xl border border-slate-800 bg-[#0f1424] p-5">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-indigo-400" />
                    Cruze de Conciliación: Suma Recibos vs TOTREP
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 leading-normal">
                    Se comparan los totales consolidados agregados de cada recibo de agente procesado con los totales declarados en el resumen TOTREP oficial. Se ignoran discrepancias de redondeo menores a $0.02.
                  </p>
                </div>

                <div className="border border-slate-800 rounded-xl overflow-hidden bg-[#0c1020]">
                  <table className="w-full border-collapse font-mono text-[11px] text-right">
                    <thead>
                      <tr className="bg-[#12182c] border-b border-slate-800 text-slate-300">
                        <th className="text-left px-5 py-3">Código</th>
                        <th className="text-left px-5 py-3">Concepto</th>
                        <th className="px-5 py-3">Tipo</th>
                        <th className="px-5 py-3">Suma Recibos (Calculado)</th>
                        <th className="px-5 py-3">TOTREP (Reportado)</th>
                        <th className="px-5 py-3">Diferencia</th>
                        <th className="text-center px-5 py-3">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {result.comparisons.map((comp) => {
                        const hasDiff = comp.difference > 0.02;
                        return (
                          <tr key={comp.code} className={`hover:bg-slate-800/30 ${hasDiff ? 'bg-rose-500/5' : ''}`}>
                            <td className="text-left px-5 py-3 font-semibold text-slate-400">{comp.code}</td>
                            <td className="text-left px-5 py-3 font-semibold text-white truncate max-w-[240px]" title={comp.name}>
                              {comp.name}
                            </td>
                            <td className="px-5 py-3">
                              {comp.type === 'DV' ? (
                                <span className="rounded-md bg-indigo-500/10 text-indigo-400 px-2 py-0.5 text-[9px] font-semibold">
                                  Haber (DV)
                                </span>
                              ) : (
                                <span className="rounded-md bg-amber-500/10 text-amber-500 px-2 py-0.5 text-[9px] font-semibold">
                                  Dcto (RT)
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3 font-semibold text-indigo-300">
                              ${comp.calculated.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-5 py-3 font-semibold text-slate-300">
                              ${comp.reported.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className={`px-5 py-3 font-bold ${hasDiff ? 'text-rose-400' : 'text-slate-500'}`}>
                              {comp.difference > 0 ? (
                                `$${comp.difference.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className="text-center px-5 py-3 font-semibold">
                              {hasDiff ? (
                                <span className="rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 text-[9px]">
                                  ⚠ Diferencia
                                </span>
                              ) : (
                                <span className="rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-[9px]">
                                  ✓ OK
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}

                      {/* Liquido comparison item */}
                      <tr className={`border-t-2 border-slate-700 bg-slate-900/35 font-bold ${
                        Math.abs(result.calculatedLiquido - result.reportedLiquido) > 0.02 ? 'bg-rose-500/10' : ''
                      }`}>
                        <td className="text-left px-5 py-4 font-bold text-emerald-400">NETO</td>
                        <td className="text-left px-5 py-4 font-bold text-white uppercase">Neto Líquido a Pagar</td>
                        <td className="px-5 py-4">
                          <span className="rounded-md bg-emerald-500/10 text-emerald-400 px-2 py-0.5 text-[9px] font-semibold">
                            Total Neto
                          </span>
                        </td>
                        <td className="px-5 py-4 text-emerald-400 text-base">
                          ${result.calculatedLiquido.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-5 py-4 text-white text-base">
                          ${result.reportedLiquido.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-5 py-4 text-base">
                          {Math.abs(result.calculatedLiquido - result.reportedLiquido) > 0.02 ? (
                            <span className="text-rose-400">
                              ${(Math.abs(result.calculatedLiquido - result.reportedLiquido)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
                        </td>
                        <td className="text-center px-5 py-4">
                          {Math.abs(result.calculatedLiquido - result.reportedLiquido) > 0.02 ? (
                            <span className="rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 text-[9px]">
                              ⚠ Diferencia
                            </span>
                          ) : (
                            <span className="rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-[9px]">
                              ✓ OK
                            </span>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 3: Diagnostic log viewer console */}
            {activeTab === 'logs' && (
              <div className="space-y-4 animate-fade-in">
                <div className="rounded-xl border border-slate-800 bg-[#0c1020] overflow-hidden shadow-lg">
                  {/* Console Header */}
                  <div className="bg-[#090c16] border-b border-slate-800 px-4 py-3 flex items-center justify-between">
                    <span className="text-xs font-mono font-semibold text-slate-300 flex items-center gap-2">
                      <Terminal className="h-4 w-4 text-indigo-400" />
                      Consola de Procesamiento
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">Ctrl + Alt + L</span>
                  </div>

                  {/* Log entries scrollbox */}
                  <div className="p-4 font-mono text-xs leading-relaxed space-y-2.5 max-h-[420px] overflow-y-auto bg-black/40">
                    {logs.map((log) => {
                      let col = 'text-slate-400';
                      if (log.type === 'success') col = 'text-emerald-400';
                      if (log.type === 'warning') col = 'text-amber-400';
                      if (log.type === 'error') col = 'text-rose-400';
                      
                      return (
                        <div key={log.id} className="flex items-start gap-3">
                          <span className="text-[10px] text-slate-600 shrink-0 select-none">[{log.timestamp}]</span>
                          <span className={col}>{log.message}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-[#070a14] px-6 py-4 text-center">
        <p className="text-[11px] text-slate-500 font-mono">
          © 2026 Liquidación de Haberes Inteligente · Hecho con tecnología React, Tailwind y Vite.
        </p>
      </footer>
    </div>
  );
}
