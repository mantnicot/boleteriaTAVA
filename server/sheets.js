const fs = require('fs');
const path = require('path');
const { getSheetsClient } = require('./auth');
const { DATA_DIR, SPREADSHEET_ID_FILE } = require('./paths');

const SHEET_EVENTOS = 'Eventos';
const SHEET_BOLETAS = 'Boletas';
let memoSpreadsheetId = null;

const EVENT_HEADERS = [
  'eventId',
  'nombreProyecto',
  'descripcion',
  'fechasJson',
  'tarifasJson',
  'direccion',
  'hora',
  'terminos',
  'vendedoresJson',
  'fondoFileId',
  'createdAt',
  'updatedAt',
];

const BOLETA_HEADERS = [
  'boletaId',
  'eventId',
  'nombre',
  'correo',
  'valorLabel',
  'cantidad',
  'fechaEvento',
  'vendedor',
  'codigoBoleta',
  'createdAt',
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStoredSpreadsheetId() {
  if (memoSpreadsheetId) return memoSpreadsheetId;
  if (process.env.GOOGLE_SHEETS_ID) return process.env.GOOGLE_SHEETS_ID.trim();
  try {
    if (fs.existsSync(SPREADSHEET_ID_FILE)) {
      const id = fs.readFileSync(SPREADSHEET_ID_FILE, 'utf8').trim();
      memoSpreadsheetId = id;
      return id;
    }
  } catch (_) {}
  return null;
}

function writeStoredSpreadsheetId(id) {
  memoSpreadsheetId = id;
  try {
    ensureDataDir();
    fs.writeFileSync(SPREADSHEET_ID_FILE, id, 'utf8');
  } catch (_) {}
}

function rowToEvent(row) {
  if (!row || !row[0]) return null;
  return {
    eventId: String(row[0]),
    nombreProyecto: row[1] ?? '',
    descripcion: row[2] ?? '',
    fechasJson: row[3] ?? '[]',
    tarifasJson: row[4] ?? '[]',
    direccion: row[5] ?? '',
    hora: row[6] ?? '',
    terminos: row[7] ?? '',
    vendedoresJson: row[8] ?? '[]',
    fondoFileId: row[9] ?? '',
    createdAt: row[10] ?? '',
    updatedAt: row[11] ?? '',
  };
}

function rowToBoleta(row) {
  if (!row || !row[0]) return null;
  const cantidad = Number(row[5]) || 0;
  const valorNum = parseValor(row[4]);
  return {
    boletaId: String(row[0]),
    eventId: String(row[1]),
    nombre: row[2] ?? '',
    correo: row[3] ?? '',
    valorLabel: row[4] ?? '',
    cantidad,
    fechaEvento: row[6] ?? '',
    vendedor: row[7] ?? '',
    codigoBoleta: row[8] ?? '',
    createdAt: row[9] ?? '',
    total: cantidad * valorNum,
  };
}

function parseValor(valorLabel) {
  if (valorLabel == null || valorLabel === '') return 0;
  const s = String(valorLabel).replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

async function createSpreadsheet() {
  const { google } = require('googleapis');
  const auth = require('./auth').getAuth();
  const client = await auth.getClient();
  const sheetsApi = google.sheets({ version: 'v4', auth: client });

  const res = await sheetsApi.spreadsheets.create({
    requestBody: {
      properties: { title: 'Boletería TAVA — base de datos' },
      sheets: [
        {
          properties: {
            title: SHEET_EVENTOS,
            gridProperties: { rowCount: 2000, columnCount: 14 },
          },
        },
        {
          properties: {
            title: SHEET_BOLETAS,
            gridProperties: { rowCount: 10000, columnCount: 12 },
          },
        },
      ],
    },
  });

  const spreadsheetId = res.data.spreadsheetId;
  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        {
          range: `${SHEET_EVENTOS}!A1:${String.fromCharCode(64 + EVENT_HEADERS.length)}1`,
          values: [EVENT_HEADERS],
        },
        {
          range: `${SHEET_BOLETAS}!A1:${String.fromCharCode(64 + BOLETA_HEADERS.length)}1`,
          values: [BOLETA_HEADERS],
        },
      ],
    },
  });

  writeStoredSpreadsheetId(spreadsheetId);
  return spreadsheetId;
}

async function getSpreadsheetId() {
  let id = readStoredSpreadsheetId();
  if (id) return id;
  id = await createSpreadsheet();
  return id;
}

async function getEventRows() {
  const sheets = await getSheetsClient();
  const spreadsheetId = await getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_EVENTOS}!A2:L`,
  });
  return res.data.values || [];
}

async function getBoletaRows() {
  const sheets = await getSheetsClient();
  const spreadsheetId = await getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_BOLETAS}!A2:J`,
  });
  return res.data.values || [];
}

async function listEvents() {
  const rows = await getEventRows();
  return rows.map(rowToEvent).filter(Boolean);
}

async function getEventById(eventId) {
  const events = await listEvents();
  return events.find((e) => e.eventId === eventId) || null;
}

function eventToRow(e) {
  return [
    e.eventId,
    e.nombreProyecto,
    e.descripcion,
    e.fechasJson,
    e.tarifasJson,
    e.direccion,
    e.hora,
    e.terminos,
    e.vendedoresJson,
    e.fondoFileId,
    e.createdAt,
    e.updatedAt,
  ];
}

async function appendEvent(event) {
  const sheets = await getSheetsClient();
  const spreadsheetId = await getSpreadsheetId();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_EVENTOS}!A:L`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [eventToRow(event)] },
  });
}

async function updateEventRow(eventId, event) {
  const rows = await getEventRows();
  const idx = rows.findIndex((r) => r[0] === eventId);
  if (idx === -1) throw new Error('Evento no encontrado');
  const rowNumber = idx + 2;
  const sheets = await getSheetsClient();
  const spreadsheetId = await getSpreadsheetId();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_EVENTOS}!A${rowNumber}:L${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [eventToRow(event)] },
  });
}

async function deleteEventRow(eventId) {
  const sheets = await getSheetsClient();
  const spreadsheetId = await getSpreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find((s) => s.properties.title === SHEET_EVENTOS);
  const sheetId = sheet.properties.sheetId;
  const rows = await getEventRows();
  const idx = rows.findIndex((r) => r[0] === eventId);
  if (idx === -1) throw new Error('Evento no encontrado');
  const rowNumber = idx + 1;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber,
              endIndex: rowNumber + 1,
            },
          },
        },
      ],
    },
  });
}

async function listBoletas() {
  const rows = await getBoletaRows();
  return rows.map(rowToBoleta).filter(Boolean);
}

async function listBoletasByEvent(eventId) {
  const all = await listBoletas();
  return all.filter((b) => b.eventId === eventId);
}

async function appendBoleta(boleta) {
  const sheets = await getSheetsClient();
  const spreadsheetId = await getSpreadsheetId();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_BOLETAS}!A:J`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [
        [
          boleta.boletaId,
          boleta.eventId,
          boleta.nombre,
          boleta.correo,
          boleta.valorLabel,
          boleta.cantidad,
          boleta.fechaEvento,
          boleta.vendedor,
          boleta.codigoBoleta,
          boleta.createdAt,
        ],
      ],
    },
  });
}

async function deleteBoletasByEvent(eventId) {
  const sheets = await getSheetsClient();
  const spreadsheetId = await getSpreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find((s) => s.properties.title === SHEET_BOLETAS);
  const sheetId = sheet.properties.sheetId;
  const rows = await getBoletaRows();
  const indicesToDelete = [];
  rows.forEach((r, i) => {
    if (r[1] === eventId) indicesToDelete.push(i);
  });
  for (let k = indicesToDelete.length - 1; k >= 0; k--) {
    const rowIndex = indicesToDelete[k] + 1;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex,
                endIndex: rowIndex + 1,
              },
            },
          },
        ],
      },
    });
  }
}

async function getBoletaById(boletaId) {
  const all = await listBoletas();
  return all.find((b) => b.boletaId === boletaId) || null;
}

module.exports = {
  getSpreadsheetId,
  readStoredSpreadsheetId,
  createSpreadsheet,
  listEvents,
  getEventById,
  appendEvent,
  updateEventRow,
  deleteEventRow,
  listBoletas,
  listBoletasByEvent,
  appendBoleta,
  deleteBoletasByEvent,
  getBoletaById,
  rowToEvent,
  parseValor,
  SHEET_EVENTOS,
  SHEET_BOLETAS,
};
