// Cell helpers shared by the Glofox seed scripts.
const getCellValue = (cell) => {
  if (!cell || cell.value === null || cell.value === undefined) return '';
  const val = cell.value;
  if (typeof val === 'object') {
    if (val.result !== null && val.result !== undefined) return String(val.result).trim();
    if (val.text !== null && val.text !== undefined) return String(val.text).trim();
    if (Array.isArray(val.richText)) {
      return val.richText
        .map((r) => r.text || '')
        .join('')
        .trim();
    }
  }
  return String(val).trim();
};

// Returns `(row, headerName) => string` for a worksheet whose headers sit on `headerRow`.
const createRowReader = (worksheet, headerRow) => {
  const colIndexMap = {};
  worksheet.getRow(headerRow).eachCell((cell, colNumber) => {
    const headerText = getCellValue(cell);
    if (headerText) colIndexMap[headerText] = colNumber;
  });
  return (row, headerName) => {
    const colIdx = colIndexMap[headerName];
    return colIdx ? getCellValue(row.getCell(colIdx)) : '';
  };
};

module.exports = { getCellValue, createRowReader };
