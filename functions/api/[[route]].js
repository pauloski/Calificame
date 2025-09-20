/**
 * Cloudflare Pages Function para manejar todas las rutas de API
 * Este archivo debe estar en functions/api/[[route]].js
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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function errorResponse(message, status = 400) {
  return new Response(JSON.stringify({ message }), {
    status: status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function generateToken() {
  return crypto.randomUUID();
}

function extractToken(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

// ==========================================
// MAIN HANDLER - CORREGIDO CON ROUTING COMPLETO
// ==========================================

export async function onRequest(context) {
  const request = context.request;
  const env = context.env;
  const path = new URL(request.url).pathname.replace('/api', '');

  console.log(`=== API REQUEST DEBUG ===`);
  console.log(`Method: ${request.method}`);
  console.log(`Path: ${path}`);
  console.log(`Full URL: ${request.url}`);

  // Manejar solicitudes OPTIONS para CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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
    console.log(`Authenticated user ID: ${userId}`);

    // ROUTING CORREGIDO Y COMPLETO
    if (path === '/reports') {
      if (request.method === 'GET') return getReports(request, env, userId);
      if (request.method === 'POST') return createReport(request, env, userId);
      return errorResponse('Method Not Allowed', 405);
    } 
    
    if (path === '/reports/search') {
      if (request.method === 'POST') return searchReports(request, env, userId);
      return errorResponse('Method Not Allowed', 405);
    }
    
    if (path.startsWith('/reports/')) {
      console.log(`Processing individual report route: ${path}`);
      const parts = path.split('/').filter(p => p);
      console.log(`Report route parts:`, parts);
      
      if (parts.length >= 2) {
        const reportId = parts[1];
        if (request.method === 'GET') return getReport(request, env, userId, reportId);
        if (request.method === 'PUT') return updateReport(request, env, userId, reportId);
        if (request.method === 'DELETE') return deleteReport(request, env, userId, reportId);
      }
      return errorResponse('Not Found', 404);
    }
    
    if (path === '/lists') {
      if (request.method === 'GET') return getLists(request, env, userId);
      if (request.method === 'POST') return createList(request, env, userId);
      return errorResponse('Method Not Allowed', 405);
    }

    // AQUÍ ESTÁ LA PARTE QUE FALTABA - MANEJO DE /lists/{id}
    if (path.startsWith('/lists/')) {
      console.log(`Processing individual list route: ${path}`);
      const parts = path.split('/').filter(p => p);
      console.log(`List route parts:`, parts);
      
      if (parts.length >= 2) {
        const listId = parts[1];
        console.log(`List ID extracted: "${listId}"`);
        
        if (request.method === 'DELETE') {
          console.log(`Calling deleteList for ID: ${listId}`);
          return deleteList(request, env, userId, listId);
        }
        if (request.method === 'GET') return getList(request, env, userId, listId);
        if (request.method === 'PUT') return updateList(request, env, userId, listId);
        
        return errorResponse('Method Not Allowed', 405);
      }
      return errorResponse('Invalid list path', 404);
    }

    console.log(`Route not found: ${path}`);
    return errorResponse('Not Found', 404);

  } catch (error) {
    console.error('Error in API handler:', error);
    return errorResponse(error.message || 'Internal Server Error', 500);
  }
}

// ==========================================
// AUTENTICACIÓN
// ==========================================

async function handleAuth(request, path, env) {
  try {
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
  } catch (error) {
    console.error('Error in auth handler:', error);
    return errorResponse(error.message || 'Authentication error', 500);
  }
}

async function registerUser(request, env) {
  try {
    const body = await request.json();
    const { name, email, university, password } = body;
    
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
    console.error('Registration error:', err);
    return errorResponse(err.message, 500);
  }
}

async function loginUser(request, env) {
  try {
    const body = await request.json();
    const { email, password } = body;
    
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
    console.error('Login error:', err);
    return errorResponse(err.message, 500);
  }
}

async function findUserByToken(token, db) {
  try {
    const user = await db.prepare('SELECT * FROM users WHERE token = ?').bind(token).first();
    if (!user) return null;
    return { id: user.id, name: user.name, email: user.email, university: user.university };
  } catch (err) {
    console.error('Find user error:', err);
    return null;
  }
}

// ==========================================
// REPORTS CRUD
// ==========================================

async function getReports(request, env, userId) {
  try {
    const { results } = await env.DB.prepare('SELECT * FROM reports WHERE user_id = ?').bind(userId).all();
    const reports = results.map(r => ({
      ...r,
      infoGeneral: JSON.parse(r.info_general || '{}'),
      configuracion: JSON.parse(r.configuracion || '{}'),
      nivelesDesempeno: JSON.parse(r.niveles_desempeno || '[]'),
      criterios: JSON.parse(r.criterios || '[]'),
      feedback: JSON.parse(r.feedback || '{}'),
      resultados: JSON.parse(r.resultados || '{}')
    }));
    return jsonResponse(reports);
  } catch (err) {
    console.error('Get reports error:', err);
    return errorResponse(err.message, 500);
  }
}

async function getReport(request, env, userId, id) {
  try {
    const report = await env.DB.prepare('SELECT * FROM reports WHERE id = ? AND user_id = ?').bind(id, userId).first();
    if (!report) {
      return errorResponse('Report not found', 404);
    }
    const parsedReport = {
      ...report,
      infoGeneral: JSON.parse(report.info_general || '{}'),
      configuracion: JSON.parse(report.configuracion || '{}'),
      nivelesDesempeno: JSON.parse(report.niveles_desempeno || '[]'),
      criterios: JSON.parse(report.criterios || '[]'),
      feedback: JSON.parse(report.feedback || '{}'),
      resultados: JSON.parse(report.resultados || '{}')
    };
    return jsonResponse(parsedReport);
  } catch (err) {
    console.error('Get report error:', err);
    return errorResponse(err.message, 500);
  }
}

async function createReport(request, env, userId) {
  try {
    const body = await request.json();
    const { id, infoGeneral, configuracion, nivelesDesempeno, criterios, feedback, resultados, listaId } = body;
    
    await env.DB.prepare(
      `INSERT INTO reports (id, user_id, list_id, info_general, configuracion, niveles_desempeno, criterios, feedback, resultados) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id || crypto.randomUUID(),
      userId,
      listaId || null,
      JSON.stringify(infoGeneral || {}),
      JSON.stringify(configuracion || {}),
      JSON.stringify(nivelesDesempeno || []),
      JSON.stringify(criterios || []),
      JSON.stringify(feedback || {}),
      JSON.stringify(resultados || {})
    ).run();
    
    return jsonResponse({ id: id }, 201);
  } catch (err) {
    console.error('Create report error:', err);
    return errorResponse(err.message, 500);
  }
}

async function updateReport(request, env, userId, id) {
  try {
    const body = await request.json();
    const { infoGeneral, configuracion, nivelesDesempeno, criterios, feedback, resultados, listaId } = body;
    
    const result = await env.DB.prepare(
      `UPDATE reports SET info_general = ?, configuracion = ?, niveles_desempeno = ?, criterios = ?, feedback = ?, resultados = ?, list_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    ).bind(
      JSON.stringify(infoGeneral || {}),
      JSON.stringify(configuracion || {}),
      JSON.stringify(nivelesDesempeno || []),
      JSON.stringify(criterios || []),
      JSON.stringify(feedback || {}),
      JSON.stringify(resultados || {}),
      listaId || null,
      id,
      userId
    ).run();
    
    if (result.meta.rows_affected === 0) {
      return errorResponse('Report not found or not authorized.', 404);
    }
    return jsonResponse({ message: 'Report updated' });
  } catch (err) {
    console.error('Update report error:', err);
    return errorResponse(err.message, 500);
  }
}

async function deleteReport(request, env, userId, id) {
  try {
    const result = await env.DB.prepare('DELETE FROM reports WHERE id = ? AND user_id = ?').bind(id, userId).run();
    if (result.meta.rows_affected === 0) {
      return errorResponse('Report not found or not authorized.', 404);
    }
    return jsonResponse({ message: 'Report deleted' });
  } catch (err) {
    console.error('Delete report error:', err);
    return errorResponse(err.message, 500);
  }
}

async function searchReports(request, env, userId) {
  try {
    const body = await request.json();
    const { title, student } = body;
    
    const { results } = await env.DB.prepare(
      `SELECT * FROM reports WHERE user_id = ? AND json_extract(info_general, '$.tituloEvaluacion') = ? AND json_extract(info_general, '$.nombreEstudiante') = ?`
    ).bind(userId, title, student).all();
    
    const reports = results.map(r => ({
      ...r,
      infoGeneral: JSON.parse(r.info_general || '{}'),
      configuracion: JSON.parse(r.configuracion || '{}'),
      nivelesDesempeno: JSON.parse(r.niveles_desempeno || '[]'),
      criterios: JSON.parse(r.criterios || '[]'),
      feedback: JSON.parse(r.feedback || '{}'),
      resultados: JSON.parse(r.resultados || '{}')
    }));

    return jsonResponse(reports);
  } catch (err) {
    console.error('Search reports error:', err);
    return errorResponse(err.message, 500);
  }
}

// ==========================================
// LISTS CRUD - COMPLETO CON DELETE
// ==========================================

async function getLists(request, env, userId) {
  try {
    console.log(`Getting lists for user: ${userId}`);
    const { results } = await env.DB.prepare('SELECT * FROM lists WHERE user_id = ?').bind(userId).all();
    console.log(`Found ${results.length} lists for user ${userId}`);
    return jsonResponse(results);
  } catch (err) {
    console.error('Get lists error:', err);
    return errorResponse(err.message, 500);
  }
}

async function createList(request, env, userId) {
  try {
    const body = await request.json();
    const { name } = body;
    
    if (!name) {
      return errorResponse('List name is required.');
    }
    
    const result = await env.DB.prepare('INSERT INTO lists (name, user_id) VALUES (?, ?)')
                                .bind(name, userId).run();
    console.log(`Created list with ID: ${result.meta.last_row_id}`);
    return jsonResponse({ id: result.meta.last_row_id, name }, 201);
  } catch (err) {
    console.error('Create list error:', err);
    return errorResponse(err.message, 500);
  }
}

// FUNCIÓN DELETELIST QUE FALTABA COMPLETAMENTE
async function deleteList(request, env, userId, id) {
  console.log(`=== DELETE LIST DEBUG ===`);
  console.log(`ID to delete: ${id} (type: ${typeof id})`);
  console.log(`User ID: ${userId} (type: ${typeof userId})`);
  
  try {
    // Convertir ID a número para asegurar consistencia
    const listIdNum = parseInt(id);
    const userIdNum = parseInt(userId);
    
    console.log(`Converted - List ID: ${listIdNum}, User ID: ${userIdNum}`);
    
    if (isNaN(listIdNum) || isNaN(userIdNum)) {
      console.log(`Invalid ID conversion - listId: ${listIdNum}, userId: ${userIdNum}`);
      return errorResponse('Invalid ID format', 400);
    }
    
    // Verificar si la lista existe
    const existingList = await env.DB.prepare('SELECT * FROM lists WHERE id = ?').bind(listIdNum).first();
    console.log(`Existing list found:`, existingList);
    
    if (!existingList) {
      console.log(`List ${listIdNum} not found in database`);
      return errorResponse('List not found', 404);
    }
    
    if (existingList.user_id !== userIdNum) {
      console.log(`List ${listIdNum} belongs to user ${existingList.user_id}, not ${userIdNum}`);
      return errorResponse('Not authorized', 403);
    }
    
    // Eliminar la lista
    console.log(`Executing DELETE query for list ${listIdNum}...`);
    const result = await env.DB.prepare('DELETE FROM lists WHERE id = ? AND user_id = ?')
      .bind(listIdNum, userIdNum)
      .run();
    
    console.log(`Delete result:`, result);
    console.log(`Rows affected: ${result.meta.rows_affected}`);
    
    if (result.meta.rows_affected === 0) {
      console.log(`No rows affected during deletion`);
      return errorResponse('Failed to delete list', 500);
    }
    
    console.log(`List ${listIdNum} deleted successfully`);
    return jsonResponse({ 
      message: 'List deleted successfully', 
      deletedId: listIdNum,
      rowsAffected: result.meta.rows_affected 
    });
    
  } catch (error) {
    console.error(`Error in deleteList:`, error);
    return errorResponse(`Database error: ${error.message}`, 500);
  }
}

// FUNCIONES ADICIONALES PARA COMPLETITUD
async function getList(request, env, userId, id) {
  console.log(`Getting list ${id} for user ${userId}`);
  
  try {
    const listIdNum = parseInt(id);
    const userIdNum = parseInt(userId);
    
    const list = await env.DB.prepare('SELECT * FROM lists WHERE id = ? AND user_id = ?')
      .bind(listIdNum, userIdNum)
      .first();
    
    if (!list) {
      console.log(`List ${listIdNum} not found for user ${userIdNum}`);
      return errorResponse('List not found', 404);
    }
    
    console.log(`Found list:`, list);
    return jsonResponse(list);
    
  } catch (error) {
    console.error(`Error getting list:`, error);
    return errorResponse(error.message, 500);
  }
}

async function updateList(request, env, userId, id) {
  console.log(`Updating list ${id} for user ${userId}`);
  
  try {
    const body = await request.json();
    const { name } = body;
    
    if (!name) {
      return errorResponse('List name is required', 400);
    }
    
    const listIdNum = parseInt(id);
    const userIdNum = parseInt(userId);
    
    const result = await env.DB.prepare('UPDATE lists SET name = ? WHERE id = ? AND user_id = ?')
      .bind(name, listIdNum, userIdNum)
      .run();
    
    console.log(`Update result:`, result);
    
    if (result.meta.rows_affected === 0) {
      console.log(`List ${listIdNum} not found or not authorized for user ${userIdNum}`);
      return errorResponse('List not found or not authorized', 404);
    }
    
    console.log(`List ${listIdNum} updated successfully`);
    return jsonResponse({ message: 'List updated', id: listIdNum, name });
    
  } catch (error) {
    console.error(`Error updating list:`, error);
    return errorResponse(error.message, 500);
  }
}