Plataforma de Evaluación Docente
🚀 Características Principales
Esta plataforma web te permite crear, gestionar y generar reportes de evaluación estudiantil con feedback docente.

✅ Sistema de autenticación (Login/Registro)

📝 Generación de reportes con información general, criterios y feedback

⚙️ Configuración flexible de escalas de calificación chilenas

📊 Cálculo automático de notas y porcentajes de logro

💾 Gestión de reportes guardados con filtros y listas

📄 Vista previa y descarga de reportes

📤 Carga masiva mediante archivos CSV

🎨 Interfaz moderna y responsive

🛠️ Stack Tecnológico
Frontend: HTML5, CSS3, JavaScript Vanilla

Backend: Cloudflare Worker (JavaScript)

Base de Datos: Cloudflare D1 (SQLite)

Hosting: Cloudflare Pages

Versionado: GitHub

📋 Configuración de Cloudflare D1 y Workers
A continuación, se detalla el proceso para configurar el entorno de backend con Cloudflare D1 y Workers, reemplazando la persistencia local por una base de datos real.

1. Preparar tu proyecto en Cloudflare Pages
Conecta tu repositorio en GitHub a Cloudflare Pages si aún no lo has hecho. Sigue las instrucciones del dashboard de Cloudflare.

Asegúrate de que el archivo index.html esté en la raíz de tu proyecto.

2. Configurar la base de datos Cloudflare D1
Instala Wrangler CLI: Es la herramienta de línea de comandos de Cloudflare.

npm install -g wrangler

Autentica con tu cuenta de Cloudflare:

wrangler auth login

Crea una nueva base de datos D1:

wrangler d1 create evaluacion-docente-db

Esto te dará un database_id único. Guarda este ID, lo necesitarás más adelante.

Crea el esquema de la base de datos: Crea un archivo llamado schema.sql en la raíz de tu proyecto con el siguiente contenido:

-- Tabla de usuarios
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    university TEXT,
    password TEXT NOT NULL,
    token TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de listas (para agrupar reportes)
CREATE TABLE IF NOT EXISTS lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Tabla de reportes
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    list_id INTEGER,
    info_general TEXT,
    configuracion TEXT,
    niveles_desempeno TEXT,
    criterios TEXT,
    feedback TEXT,
    resultados TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (list_id) REFERENCES lists (id) ON DELETE SET NULL
);

-- Índices para optimización
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

Ejecuta la migración del esquema en tu base de datos:

wrangler d1 execute evaluacion-docente-db --remote --file=./schema.sql

Confirma que las tablas se hayan creado ejecutando:

wrangler d1 execute evaluacion-docente-db --remote --command="SELECT name FROM sqlite_master WHERE type='table';"

3. Configurar el Cloudflare Worker
Crea un archivo wrangler.toml en la raíz de tu proyecto con este contenido. Reemplaza TU_DATABASE_ID_AQUI con el ID que obtuviste en el paso 2.3.

name = "plataforma-evaluacion"
compatibility_date = "2024-03-15"

[[d1_databases]]
binding = "DB"
database_name = "evaluacion-docente-db"
database_id = "TU_DATABASE_ID_AQUI"

[site]
bucket = "./"
entry-point = "worker.js"

Crea una carpeta src y copia el archivo worker.js dentro de ella. (o ajusta el wrangler.toml si lo dejas en la raíz).

Configura el wrangler.toml para tu proyecto. Asegúrate de que apunte al archivo worker.js como tu entry-point.

4. Desplegar tu aplicación
Sube los archivos a tu repositorio de GitHub. Asegúrate de incluir:

index.html

worker.js

wrangler.toml

schema.sql

Despliega en Cloudflare Pages. Si ya tienes el proyecto conectado, Pages detectará los cambios y hará un nuevo despliegue. Cloudflare Pages usará el archivo wrangler.toml para vincular tu Worker y tu base de datos D1 automáticamente.

Notas importantes:
El código del worker.js incluye una lógica de autenticación simple. Para un entorno de producción, se recomienda una solución más robusta como JSON Web Tokens (JWT).

El manejo de errores en el frontend y el backend está diseñado para ser informativo. Revisa la consola del navegador para ver los mensajes de error de la API.

Las funciones para descargar PDF (descargarPDF y descargarListadoCompleto) en el index.html son placeholders. La generación de PDF generalmente se realiza en el backend o con librerías pesadas en el frontend, lo cual está fuera del alcance de este proyecto inicial con Vanilla JS. La lógica de la API ya está preparada para una posible integración futura.