let dbInstance = null;
let isLoading = false;
let initPromise = null;

export async function initDuckDB() {
  if (dbInstance) return dbInstance;
  if (isLoading) return initPromise;
  
  isLoading = true;
  
  try {
    const duckdb = await import('@duckdb/duckdb-wasm');
    
    const bundles = {
      mvp: {
        mainModule: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@latest/dist/duckdb-mvp.wasm',
        mainWorker: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@latest/dist/duckdb-browser-mvp.worker.js',
      },
      eh: {
        mainModule: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@latest/dist/duckdb-eh.wasm',
        mainWorker: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@latest/dist/duckdb-browser-eh.worker.js',
      },
    };
    
    const bundle = await duckdb.selectBundle(bundles);
    const worker = await duckdb.createDuckDB(bundle, {
      query: { castBigIntToNumber: true }
    });
    
    await worker.open();
    const conn = await worker.connect();
    
    dbInstance = { worker, conn };
    isLoading = false;
    return dbInstance;
  } catch (error) {
    console.error('Failed to initialize DuckDB:', error);
    isLoading = false;
    throw error;
  }
}

export async function parseDtaFile(fileArrayBuffer, fileName) {
  const { conn } = await initDuckDB();
  
  try {
    const arr = new Uint8Array(fileArrayBuffer);
    await conn.registerFileBuffer(fileName, arr);
    
    const result = await conn.query(`SELECT * FROM read_stata('${fileName}')`);
    const data = result.toArray();
    const fields = result.schema.fields.map(field => field.name);
    
    return { data, meta: { fields } };
  } catch (error) {
    console.error('Error parsing dta file:', error);
    throw error;
  }
}
