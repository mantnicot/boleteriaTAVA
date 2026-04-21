const ExcelJS = require('exceljs');

async function buildVerificacionReportBuffer(event, boletasRows) {
  const wb = new ExcelJS.Workbook();
  const nombreEv = (event && event.nombreProyecto) || event.eventId;
  const wsV = wb.addWorksheet('Ingresos completos', {
    properties: { defaultColWidth: 18 },
  });
  const wsP = wb.addWorksheet('Pendientes o parciales', {
    properties: { defaultColWidth: 18 },
  });

  const head = (ws) => {
    ws.addRow([`Evento: ${nombreEv}`, event?.eventId || '']);
    ws.addRow(['Generado (ISO):', new Date().toISOString()]);
    ws.addRow([]);
  };
  head(wsV);
  head(wsP);

  const cols = [
    { header: 'Código boleta', key: 'codigoBoleta', width: 22 },
    { header: 'Nombre', key: 'nombre', width: 28 },
    { header: 'Correo', key: 'correo', width: 32 },
    { header: 'Fecha función', key: 'fechaEvento', width: 14 },
    { header: 'Cantidad (cupo)', key: 'cantidad', width: 14 },
    { header: 'Ingresados', key: 'ingresados', width: 12 },
    { header: 'Última act. (ISO)', key: 'verificacionUpdatedAt', width: 24 },
  ];

  wsV.columns = cols;
  wsP.columns = [
    ...cols,
    { header: 'Faltan por ingresar', key: 'faltan', width: 18 },
  ];

  for (const b of boletasRows) {
    if (b.estado === 'completo') {
      wsV.addRow({
        codigoBoleta: b.codigoBoleta,
        nombre: b.nombre,
        correo: b.correo,
        fechaEvento: b.fechaEvento,
        cantidad: b.cantidad,
        ingresados: b.ingresados,
        verificacionUpdatedAt: b.verificacionUpdatedAt,
      });
    } else {
      wsP.addRow({
        codigoBoleta: b.codigoBoleta,
        nombre: b.nombre,
        correo: b.correo,
        fechaEvento: b.fechaEvento,
        cantidad: b.cantidad,
        ingresados: b.ingresados,
        verificacionUpdatedAt: b.verificacionUpdatedAt,
        faltan: b.restante,
      });
    }
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { buildVerificacionReportBuffer };
