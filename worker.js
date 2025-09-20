/**
 * Cloudflare Worker actúa como un proxy para la base de datos D1.
 * Maneja la autenticación y las operaciones CRUD.
 *
 * NOTA: Este es un ejemplo simplificado. La autenticación de usuarios
 * en un entorno de producción debería usar JWT o un sistema similar.
 */

// Define las cabeceras CORS para todas las respuestas
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ==========================================
// UTILITIES
// ==========================================

/**
 * Crea una respuesta JSON
 * @param {Object} data - Los datos a devolver.
 * @param {Number} status - El código de estado HTTP.
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/**
 * Crea una respuesta de error JSON
 * @param {String} message - El mensaje de error.
 * @param {Number} status - El código de estado HTTP.
 */
function errorResponse(message, status = 400) {
  return new Response(JSON.stringify({ message }), {
    status: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/**
 * Genera un token de autenticación simple (UUID).
 * En producción, esto debería ser un JWT.
 */
function generateToken() {
  return crypto.randomUUID();
}

/**
 * Extrae el token de la cabecera de autorización.
 */
function extractToken(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

// ==========================================
// API Handlers
// ==========================================

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '');

  // Manejar solicitudes de pre-vuelo OPTIONS para CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Rutas de autenticación
  if (path.startsWith('/auth/')) {
    return handleAuth(request, path, env);
  }

  // Todas las demás rutas requieren autenticación
  const token = extractToken(request);
  if (!token) {
    return errorResponse('Authentication required', 401);
  }
  const user = await findUserByToken(token, env.DB);
  if (!user) {
    return errorResponse('Invalid token', 401);
  }

  const userId = user.id;

  if (path === '/reports') {
    if (request.method === 'GET') return getReports(request, env, userId);
    if (request.method === 'POST') return createReport(request, env, userId);
    return errorResponse('Method Not Allowed', 405);
  } else if (path.startsWith('/reports/')) {
    const parts = path.split('/');
    if (parts.length === 3) {
      const reportId = parts[2];
      if (request.method === 'GET') return getReport(request, env, userId, reportId);
      if (request.method === 'PUT') return updateReport(request, env, userId, reportId);
      if (request.method === 'DELETE') return deleteReport(request, env, userId, reportId);
    }
    return errorResponse('Not Found', 404);
  } else if (path === '/reports/search') {
    if (request.method === 'POST') return searchReports(request, env, userId);
    return errorResponse('Method Not Allowed', 405);
  } else if (path.startsWith('/lists/')) {
    const parts = path.split('/');
    if (parts.length === 3) {
      const listId = parts[2];
      if (request.method === 'DELETE') return deleteList(request, env, userId, listId);
    }
    return errorResponse('Not Found', 404);
  } else if (path === '/lists') {
    if (request.method === 'GET') return getLists(request, env, userId);
    if (request.method === 'POST') return createList(request, env, userId);
    return errorResponse('Method Not Allowed', 405);
  } else {
    return errorResponse('Not Found', 404);
  }
}

// ==========================================
// AUTENTICACIÓN
// ==========================================

async function handleAuth(request, path, env) {
  switch (path) {
    case '/auth/register':
      if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405);
      return registerUser(request, env);
    case '/auth/login':
      if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405);
      return loginUser(request, env);
    case '/auth/me':
      if (request.method !== 'GET') return errorResponse('Method Not Allowed', 405);
      const token = extractToken(request);
      if (!token) {
        return errorResponse('Authentication required', 401);
      }
      const user = await findUserByToken(token, env.DB);
      if (!user) {
        return errorResponse('Invalid token', 401);
      }
      return jsonResponse(user);
    default:
      return errorResponse('Not Found', 404);
  }
}

async function registerUser(request, env) {
  try {
    const { name, email, university, password } = await request.json();
    if (!name || !email || !university || !password) {
      return errorResponse('Name, email, university, and password are required.');
    }

    const existingUser = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (existingUser) {
      return errorResponse('Email already registered.', 409);
    }

    const token = generateToken();
    const result = await env.DB.prepare(
      'INSERT INTO users (name, email, university, password, token) VALUES (?, ?, ?, ?, ?)'
    ).bind(name, email, university, password, token).run();

    const user = { id: result.meta.last_row_id, name, email, university };
    return jsonResponse({ user, token }, 201);
  } catch (err) {
    return errorResponse(err.message, 500);
  }
}

async function loginUser(request, env) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return errorResponse('Email and password are required.');
    }

    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ? AND password = ?').bind(email, password).first();
    if (!user) {
      return errorResponse('Invalid email or password.', 401);
    }

    const token = generateToken();
    await env.DB.prepare('UPDATE users SET token = ? WHERE id = ?').bind(token, user.id).run();

    const loggedInUser = { id: user.id, name: user.name, email: user.email, university: user.university };
    return jsonResponse({ user: loggedInUser, token });
  } catch (err) {
    return errorResponse(err.message, 500);
  }
}

async function findUserByToken(token, db) {
  const user = await db.prepare('SELECT * FROM users WHERE token = ?').bind(token).first();
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, university: user.university };
}

// ==========================================
// REPORTS CRUD
// ==========================================

async function getReports(request, env, userId) {
  const { results } = await env.DB.prepare('SELECT * FROM reports WHERE user_id = ?').bind(userId).all();
  const reports = results.map(r => ({
    ...r,
    infoGeneral: JSON.parse(r.info_general),
    configuracion: JSON.parse(r.configuracion),
    nivelesDesempeno: JSON.parse(r.niveles_desempeno),
    criterios: JSON.parse(r.criterios),
    feedback: JSON.parse(r.feedback),
    resultados: JSON.parse(r.resultados)
  }));
  return jsonResponse(reports);
}

async function getReport(request, env, userId, id) {
  const report = await env.DB.prepare('SELECT * FROM reports WHERE id = ? AND user_id = ?').bind(id, userId).first();
  if (!report) {
    return errorResponse('Report not found', 404);
  }
  const parsedReport = {
    ...report,
    infoGeneral: JSON.parse(report.info_general),
    configuracion: JSON.parse(report.configuracion),
    nivelesDesempeno: JSON.parse(report.niveles_desempeno),
    criterios: JSON.parse(report.criterios),
    feedback: JSON.parse(report.feedback),
    resultados: JSON.parse(report.resultados)
  };
  return jsonResponse(parsedReport);
}

async function createReport(request, env, userId) {
  try {
    const { id, infoGeneral, configuracion, nivelesDesempeno, criterios, feedback, resultados, listaId } = await request.json();
    const result = await env.DB.prepare(
      `INSERT INTO reports (id, user_id, list_id, info_general, configuracion, niveles_desempeno, criterios, feedback, resultados) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      userId,
      listaId || null,
      JSON.stringify(infoGeneral),
      JSON.stringify(configuracion),
      JSON.stringify(nivelesDesempeno),
      JSON.stringify(criterios),
      JSON.stringify(feedback),
      JSON.stringify(resultados)
    ).run();
    return jsonResponse({ id: id }, 201);
  } catch (err) {
    return errorResponse(err.message, 500);
  }
}

async function updateReport(request, env, userId, id) {
  try {
    const { infoGeneral, configuracion, nivelesDesempeno, criterios, feedback, resultados, listaId } = await request.json();
    const result = await env.DB.prepare(
      `UPDATE reports SET info_general = ?, configuracion = ?, niveles_desempeno = ?, criterios = ?, feedback = ?, resultados = ?, list_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    ).bind(
      JSON.stringify(infoGeneral),
      JSON.stringify(configuracion),
      JSON.stringify(nivelesDesempeno),
      JSON.stringify(criterios),
      JSON.stringify(feedback),
      JSON.stringify(resultados),
      listaId || null,
      id,
      userId
    ).run();
    if (result.meta.rows_affected === 0) {
      return errorResponse('Report not found or not authorized.', 404);
    }
    return jsonResponse({ message: 'Report updated' });
  } catch (err) {
    return errorResponse(err.message, 500);
  }
}

async function deleteReport(request, env, userId, id) {
  const result = await env.DB.prepare('DELETE FROM reports WHERE id = ? AND user_id = ?').bind(id, userId).run();
  if (result.meta.rows_affected === 0) {
    return errorResponse('Report not found or not authorized.', 404);
  }
  return jsonResponse({ message: 'Report deleted' });
}

async function searchReports(request, env, userId) {
  try {
    const { title, student } = await request.json();
    const { results } = await env.DB.prepare(
      `SELECT * FROM reports WHERE user_id = ? AND json_extract(info_general, '$.tituloEvaluacion') = ? AND json_extract(info_general, '$.nombreEstudiante') = ?`
    ).bind(userId, title, student).all();
    
    const reports = results.map(r => ({
      ...r,
      infoGeneral: JSON.parse(r.info_general),
      configuracion: JSON.parse(r.configuracion),
      nivelesDesempeno: JSON.parse(r.niveles_desempeno),
      criterios: JSON.parse(r.criterios),
      feedback: JSON.parse(r.feedback),
      resultados: JSON.parse(r.resultados)
    }));

    return jsonResponse(reports);
  } catch (err) {
    return errorResponse(err.message, 500);
  }
}

// ==========================================
// LISTS CRUD
// ==========================================

async function getLists(request, env, userId) {
  const { results } = await env.DB.prepare('SELECT * FROM lists WHERE user_id = ?').bind(userId).all();
  return jsonResponse(results);
}

async function createList(request, env, userId) {
  try {
    const { name } = await request.json();
    if (!name) {
      return errorResponse('List name is required.');
    }
    const result = await env.DB.prepare('INSERT INTO lists (name, user_id) VALUES (?, ?)')
                                .bind(name, userId).run();
    return jsonResponse({ id: result.meta.last_row_id, name }, 201);
  } catch (err) {
    return errorResponse(err.message, 500);
  }
}

async function deleteList(request, env, userId, id) {
  const result = await env.DB.prepare('DELETE FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).run();
  if (result.meta.rows_affected === 0) {
    return errorResponse('List not found or not authorized.', 404);
  }
  return jsonResponse({ message: 'List deleted' });
}

// ==========================================
// EXPORT
// ==========================================

export default {
  async fetch(request, env) {
    try {
      return handleRequest(request, env);
    } catch (e) {
      return errorResponse(e.message, 500);
    }
  },

};
