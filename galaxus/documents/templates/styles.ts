export const baseStyles = `
  @page { size: A4; margin: 14mm 12mm; }

  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; }
  .row { display: flex; justify-content: space-between; gap: 18px; }
  .col { flex: 1; }
  .muted { color: #555; }
  .title { font-size: 18px; font-weight: 700; margin: 0 0 10px 0; }
  .box { border: 1px solid #000; padding: 8px; }
  .mb8 { margin-bottom: 8px; }
  .mb12 { margin-bottom: 12px; }
  .mb16 { margin-bottom: 16px; }
  .right { text-align: right; }
  .small { font-size: 10px; }
  .hr { border-top: 1px solid #000; margin: 10px 0; }
  .nowrap { white-space: nowrap; }

  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th, td { border: 1px solid #000; padding: 6px 6px; vertical-align: top; }
  th { background: #f2f2f2; font-weight: 700; }

  .w-art { width: 14%; }
  .w-desc { width: 32%; }
  .w-qty { width: 8%; }
  .w-vat { width: 8%; }
  .w-vatamt { width: 10%; }
  .w-unit { width: 14%; }
  .w-line { width: 14%; }

  .totals { width: 45%; margin-left: auto; }
  .totals td { border: none; padding: 3px 0; }
  .totals .label { padding-right: 10px; }
  .totals .strong { font-weight: 700; }

  .footer { margin-top: 14px; font-size: 10px; color: #444; }
`;

export const labelStyles = `
  @page { size: 4in 6in; margin: 8mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; }
  .label { border: 2px solid #000; padding: 12px; height: 100%; }
  .title { font-size: 20px; font-weight: 700; margin-bottom: 10px; }
  .section { font-size: 14px; margin-bottom: 8px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .address { border: 2px solid #000; padding: 8px; min-height: 80px; font-size: 13px; line-height: 1.2; }
  .barcode { border: 2px solid #000; padding: 10px; text-align: center; margin-top: 12px; }
  .barcode img { width: 100%; height: 70px; object-fit: contain; }
  .barcode-text { font-size: 13px; margin-top: 6px; }
`;
