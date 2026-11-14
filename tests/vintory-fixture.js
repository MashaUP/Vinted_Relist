// Esportazioni «Per Vinted_Relist» finte, con la stessa forma di quelle di Vintory 1.1.x
// (formato vintory-relist, schema 2): per i test e per le prove in Chromium.
// Nessun dato vero: le foto sono JPEG minimi generati qui.
const zlib = require('zlib');
const crypto = require('crypto');

const TAB = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = TAB[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** ZIP classico: file { nome, dati: Buffer }, metodo 0 (stored) o 8 (deflate). */
function zip(file, { deflate = false } = {}) {
  const parti = []; const centrale = []; let off = 0;
  for (const f of file) {
    const nome = Buffer.from(f.nome, 'utf8');
    const dati = Buffer.isBuffer(f.dati) ? f.dati : Buffer.from(f.dati);
    const comp = deflate ? zlib.deflateRawSync(dati) : dati;
    const crc = crc32(dati);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(deflate ? 8 : 0, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(dati.length, 22); h.writeUInt16LE(nome.length, 26);
    parti.push(h, nome, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(deflate ? 8 : 0, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(dati.length, 24); c.writeUInt16LE(nome.length, 28); c.writeUInt32LE(off, 42);
    centrale.push(c, nome);
    off += 30 + nome.length + comp.length;
  }
  const cd = Buffer.concat(centrale);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(file.length, 8); e.writeUInt16LE(file.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parti, cd, e]);
}

/**
 * JPEG valido di larghezza w (altezza h), di un colore: serve a riconoscere
 * l'ordine delle foto anche dopo la ricodifica (la larghezza resta).
 * Si appoggia su una foto vera (base) e ne cambia le dimensioni nel SOF? No:
 * il decoder le rifiuterebbe. Se c'e' una funzione per generarle (Chromium)
 * la usa chi chiama; qui si accetta un Buffer gia' pronto.
 */
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** Annuncio nella forma di Vintory (relistEntry), con un uploadDraft come quello di Vinted. */
function annuncio({ id, seller = '77', titolo = `Annuncio ${id}`, prezzo = 5, foto = [], online = 'offline', catalog = 2319, condizione = 2, edited = [], draft = true, photosMissing = 0, extra = {} }) {
  const fotoVoci = foto.map((b, i) => ({ file: `photos/${id}/${String(i + 1).padStart(2, '0')}.jpg`, type: 'image/jpeg', width: 100 + i, height: 100, sha256: sha(b) }));
  return {
    vintedId: String(id), url: `https://www.vinted.it/items/${id}-prova`, origin: 'https://www.vinted.it', sellerId: seller,
    online, onlineCheckedAt: 1794607081275, savedAt: 1794606976720, publishedAt: null,
    title: titolo, description: `Descrizione di ${titolo}`, price: prezzo, currency: 'EUR',
    brand: null, category: 'Intrattenimento › Libri', size: null, colors: [], condition: 'Ottime',
    ids: { brandId: null, catalogId: String(catalog), sizeId: null, statusId: String(condizione), colorIds: [] },
    extra, editedFields: edited, photos: fotoVoci, photosMissing,
    uploadDraft: draft ? {
      id: Number(id), title: `${titolo} (vecchio)`, color1_id: null, color2_id: null, catalog_id: catalog, package_size_id: 1,
      domestic_shipment_price: null, international_shipment_price: null, shipment_prices: null, brand_id: null,
      description: 'descrizione vecchia', currency: 'EUR', photos: [{ id: 1, url: 'https://images1.vinted.net/tc/x/f800/1.jpeg' }],
      ai_photo: null, price: { amount: String(prezzo + 1), currency_code: 'EUR' }, author: null, book_title: null, isbn: '9781529095258',
      measurement_width: null, measurement_length: null, measurement_unit: null, item_attributes: [{ code: 'condition', ids: [condizione] }],
      ontology_collection_id: null, ontology_model_id: null, is_draft: false, brand_dto: null, color1: null, color2: null,
      can_push_up: true, promoted: false, item_alert: null, manufacturer: null, manufacturer_labelling: null, model: null,
    } : null,
    uploadDraftAt: 1794606976720,
  };
}

/** ZIP completo: annunci [{ ...opzioni di annuncio, foto: [Buffer] }]; altera: { "photos/..": Buffer } sostituisce un file. */
function esportazione(annunci, { deflate = false, altera = {}, togli = [], json = null } = {}) {
  const listings = annunci.map(annuncio);
  const file = [];
  annunci.forEach((a, k) => a.foto.forEach((b, i) => file.push({ nome: listings[k].photos[i].file, dati: b })));
  const pacchetto = json || { format: 'vintory-relist', schema: 2, app: 'Vintory 1.1.1', exportedAt: new Date(0).toISOString(), count: listings.length, listings };
  file.push({ nome: 'vintory-relist.json', dati: JSON.stringify(pacchetto, null, 2) });
  const finali = file.filter((f) => !togli.includes(f.nome)).map((f) => (altera[f.nome] ? { ...f, dati: altera[f.nome] } : f));
  return { zip: zip(finali, { deflate }), pacchetto };
}

module.exports = { zip, crc32, sha, annuncio, esportazione };
