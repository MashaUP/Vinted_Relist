/**
 * Lettore ZIP senza dipendenze, per gli archivi «Per Vinted_Relist» di Vintory.
 * Adattato da src/shared/zip.js di Vintory (stesso autore, licenza MIT).
 * Legge «stored» e «deflate» (DecompressionStream). Non carica tutto in
 * memoria: legge l'indice in fondo al file e ogni voce solo quando serve.
 * Limiti del formato classico: 4 GB e 65 535 file (niente ZIP64).
 *
 * Uso: const voci = await VintoryZip.leggi(file);  voci.get("vintory-relist.json").text()
 */
(function (root) {
  "use strict";

  const TABELLA = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes, crc = 0) {
    let c = (crc ^ 0xffffffff) >>> 0;
    for (let i = 0; i < bytes.length; i++) c = TABELLA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // Creato al primo uso: la pagina si carica anche dove TextDecoder manca (DOM simulato dei test).
  let decoder = null;
  const dec = { decode: (b) => (decoder ||= new TextDecoder()).decode(b) };
  const MAX = 0xffffffff;

  /** Nomi pericolosi (percorsi assoluti, «..», barre rovesciate) non si leggono. */
  const nomeSicuro = (nome) => nome && !nome.startsWith("/") && !nome.includes("\\") && !nome.split("/").includes("..") && !/[\u0000-\u001f]/.test(nome);

  /** Indice dello ZIP: Map nome → { name, size, crc, method, blob(tipo), bytes(), text() }. */
  async function leggi(blob) {
    if (!blob || typeof blob.slice !== "function") throw new Error("Nessun file da leggere.");
    if (blob.size < 22) throw new Error("Il file non è uno ZIP valido.");
    const coda = Math.min(blob.size, 65557);
    const tail = new Uint8Array(await blob.slice(blob.size - coda).arrayBuffer());
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
    if (eocd < 0) throw new Error("Il file non è uno ZIP valido.");
    const ev = new DataView(tail.buffer, tail.byteOffset + eocd);
    const quanti = ev.getUint16(10, true);
    const cdSize = ev.getUint32(12, true);
    const cdOffset = ev.getUint32(16, true);
    if (cdOffset === MAX || quanti === 0xffff) throw new Error("ZIP64 non supportato: l'archivio supera i limiti del formato classico.");
    if (cdOffset + cdSize > blob.size) throw new Error("Indice dello ZIP danneggiato.");
    const cd = new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
    const voci = new Map();
    let p = 0;
    for (let i = 0; i < quanti; i++) {
      if (p + 46 > cd.length || v.getUint32(p, true) !== 0x02014b50) throw new Error("Indice dello ZIP danneggiato.");
      const metodo = v.getUint16(p + 10, true);
      const crc = v.getUint32(p + 16, true);
      const csize = v.getUint32(p + 20, true);
      const usize = v.getUint32(p + 24, true);
      const nlen = v.getUint16(p + 28, true);
      const xlen = v.getUint16(p + 30, true);
      const clen = v.getUint16(p + 32, true);
      const locale = v.getUint32(p + 42, true);
      const nome = dec.decode(cd.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (nome.endsWith("/") || !nomeSicuro(nome)) continue;
      const voce = {
        name: nome, size: usize, crc, method: metodo,
        async blob(tipo = "") {
          const lh = new DataView(await blob.slice(locale, locale + 30).arrayBuffer());
          if (lh.getUint32(0, true) !== 0x04034b50) throw new Error(`ZIP danneggiato: ${nome}`);
          const inizio = locale + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
          const grezzo = blob.slice(inizio, inizio + csize);
          if (metodo === 0) return grezzo.slice(0, grezzo.size, tipo);
          if (metodo !== 8) throw new Error(`Compressione non supportata per ${nome}`);
          const flusso = grezzo.stream().pipeThrough(new DecompressionStream("deflate-raw"));
          return new Blob([await new Response(flusso).arrayBuffer()], { type: tipo });
        },
        async bytes() { return new Uint8Array(await (await voce.blob()).arrayBuffer()); },
        async text() { return dec.decode(await voce.bytes()); },
      };
      voci.set(nome, voce);
    }
    return voci;
  }

  const api = { leggi, crc32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VintoryZip = api;
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
