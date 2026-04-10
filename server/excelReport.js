const ExcelJS = require('exceljs');

async function buildTotalEventosExcel(events, boletas) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Resumen eventos');

  ws.columns = [
    { header: 'ID evento', key: 'eventId', width: 36 },
    { header: 'Nombre proyecto', key: 'nombre', width: 28 },
    { header: 'Dirección', key: 'direccion', width: 32 },
    { header: 'Hora', key: 'hora', width: 12 },
    { header: 'Cantidad boletas', key: 'numBoletas', width: 18 },
    { header: 'Entradas vendidas (personas)', key: 'personas', width: 26 },
    { header: 'Total recaudo estimado', key: 'totalDinero', width: 22 },
    { header: 'Fechas (JSON)', key: 'fechas', width: 40 },
    { header: 'Tarifas (JSON)', key: 'tarifas', width: 40 },
  ];

  for (const e of events) {
    const bs = boletas.filter((b) => b.eventId === e.eventId);
    const personas = bs.reduce((s, b) => s + (Number(b.cantidad) || 0), 0);
    const totalDinero = bs.reduce((s, b) => s + (Number(b.total) || 0), 0);
    ws.addRow({
      eventId: e.eventId,
      nombre: e.nombreProyecto,
      direccion: e.direccion,
      hora: e.hora,
      numBoletas: bs.length,
      personas,
      totalDinero,
      fechas: e.fechasJson,
      tarifas: e.tarifasJson,
    });
  }

  const ws2 = wb.addWorksheet('Todas las boletas');
  ws2.columns = [
    { header: 'boletaId', key: 'boletaId', width: 36 },
    { header: 'eventId', key: 'eventId', width: 36 },
    { header: 'Nombre proyecto', key: 'nombreEvento', width: 24 },
    { header: 'Nombre boleta', key: 'nombre', width: 24 },
    { header: 'Correo', key: 'correo', width: 28 },
    { header: 'Valor', key: 'valorLabel', width: 16 },
    { header: 'Cantidad', key: 'cantidad', width: 10 },
    { header: 'Total', key: 'total', width: 12 },
    { header: 'Vendedor', key: 'vendedor', width: 20 },
    { header: 'Fecha evento', key: 'fechaEvento', width: 14 },
    { header: 'Código', key: 'codigoBoleta', width: 20 },
    { header: 'Creado', key: 'createdAt', width: 22 },
  ];

  const eventMap = Object.fromEntries(events.map((ev) => [ev.eventId, ev.nombreProyecto]));
  for (const b of boletas) {
    ws2.addRow({
      ...b,
      nombreEvento: eventMap[b.eventId] || '',
    });
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { buildTotalEventosExcel };
