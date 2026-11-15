# Guía de Despliegue en la Nube — Costo Cero ($0/mes Permanente)

Esta guía documenta el procedimiento paso a paso para desplegar HookRelay en infraestructura de nube pública sin costo de suscripción y sin requerir tarjeta de crédito en ninguno de los proveedores seleccionados.

---

## 1. Topología de la Arquitectura Gratuita

```mermaid
flowchart TD
    subgraph Client["Cliente / Navegador"]
        User["Usuario Operador"]
    end

    subgraph KeepAlive["Monitor Externo"]
        UptimeRobot["UptimeRobot (Ping cada 10m)"]
    end

    subgraph CloudFrontend["Vercel (Edge Network)"]
        Dashboard["Next.js 15 Dashboard\n(apps/dashboard)"]
    end

    subgraph CloudBackend["Render.com (Free Web Service)"]
        API["NestJS API & BullMQ Worker\n(Docker Container :3000)"]
    end

    subgraph CloudData["Capa de Datos Persistente"]
        NeonDB[("Neon.tech PostgreSQL 16\n(0.5 GB Storage, RLS, Particiones)")]
        RedisCloud[("Upstash / Redis Cloud\n(Redis 7+, TLS rediss://)")]
        S3Storage[("Supabase Storage / Cloudflare R2\n(S3 Compatible, 1-10 GB)")]
    end

    User -->|"HTTPS"| Dashboard
    Dashboard -->|"REST API / CORS"| API
    UptimeRobot -->|"GET /health"| API
    API -->|"TLS :5432 (sslmode=require)"| NeonDB
    API -->|"TLS :6379 (rediss://)"| RedisCloud
    API -->|"HTTPS / S3 API"| S3Storage
```

### Límites de los Planes Gratuitos

| Componente | Proveedor | Nivel Gratuito | Requisito de Tarjeta |
| :--- | :--- | :--- | :--- |
| **Base de Datos** | Neon.tech | 0.5 GB almacenamiento, Postgres 16 con RLS nativo | No |
| **Cola & Caché** | Upstash / Redis Cloud | 10.000 comandos/día o 30 MB fijos | No |
| **Almacenamiento Frío** | Supabase Storage / Cloudflare R2 | 1 GB a 10 GB almacenamiento compatible con S3 | No |
| **Backend & Worker** | Render.com | 750 horas de cómputo mensual (suficiente para 1 servicio 24/7) | No |
| **Dashboard UI** | Vercel | Ancho de banda ilimitado para proyectos personales | No |
| **Keep-Alive** | UptimeRobot | 50 monitores HTTP cada 5 minutos | No |

---

## 2. Paso 1: Base de Datos Relacional (PostgreSQL 16 en Neon)

Neon provee instancias serverless de PostgreSQL 16 con soporte íntegro para Row-Level Security (RLS), particionamiento declarativo y triggers PL/pgSQL.

### 2.1. Creación del Proyecto
1. Ingresar en [neon.tech](https://neon.tech) e iniciar sesión con GitHub o Google.
2. Hacer clic en **Create Project**.
3. Configurar:
   - **Project name:** `hookrelay-db`
   - **Postgres version:** `16`
   - **Region:** Seleccionar la región más cercana (ej. `US East (Ohio)` o `Europe (Frankfurt)`).
4. Guardar la cadena de conexión generada en el panel:
   ```text
   postgresql://hookrelay_owner:TuClaveSegura@ep-xyz-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

### 2.2. Ejecución del Esquema DDL
1. Dentro de la consola de Neon, abrir la pestaña **SQL Editor**.
2. Abrir el archivo local `database/schema.sql` del repositorio HookRelay, copiar todo su contenido y pegarlo en el editor SQL.
3. Ejecutar el script. Este comando crea:
   - Extensiones (`uuid-ossp`, `pgcrypto`).
   - Tablas principales normalizadas (`tenants`, `api_keys`, `event_topics`, `events`, `webhook_endpoints`, `endpoint_subscriptions`, `deliveries`, `delivery_attempts`).
   - Políticas de seguridad Row-Level Security (RLS).
   - Vistas operacionales (`v_endpoint_health_metrics`, `v_delivery_metrics`).
   - Triggers de auditoría y circuit breaker.

### 2.3. Ejecución del Seed Inicial
Para cargar los datos de prueba y tenant demostrativo:
1. Desde tu entorno local, exportar la variable `DATABASE_URL` apuntando a Neon:
   ```bash
   DATABASE_URL="postgresql://hookrelay_owner:TuClaveSegura@ep-xyz-123456.us-east-2.aws.neon.tech/neondb?sslmode=require" npm --prefix apps/api run seed
   ```
2. Alternativamente, ejecutar las sentencias de inserción de `apps/api/prisma/seed.ts` directamente en el SQL Editor de Neon para crear el tenant `Acme Corporation`, la clave de API `hr_live_demo_key_sec_0001` y los tópicos de prueba.

---

## 3. Paso 2: Cola y Coordinación Distribuida (Redis 7 en Upstash o Redis Cloud)

HookRelay utiliza BullMQ sobre Redis para orquestar los reintentos, el backoff exponencial y el aislamiento de concurrencia.

### Opción Recomendada: Upstash Redis
1. Registrarse en [upstash.com](https://upstash.com) con GitHub o Google.
2. Hacer clic en **Create Database**.
3. Seleccionar:
   - **Name:** `hookrelay-queue`
   - **Region:** Misma región geográfica elegida en Neon.
   - **Type:** Regional (Free Tier).
4. En el panel de la base de datos, ir a la sección **Node.js** o **iORedis** y copiar la URL con esquema TLS:
   ```text
   rediss://default:clave_upstash@us1-flowing-terrapin-30000.upstash.io:6379
   ```

> [!IMPORTANT]
> HookRelay soporta nativamente el protocolo seguro `rediss://` y configura automáticamente `maxRetriesPerRequest: null`, `lazyConnect: true` y `enableReadyCheck: false` en `IORedis` tal como lo exige BullMQ en conexiones dedicadas.

---

## 4. Paso 3: Almacenamiento Frío S3 (Supabase Storage o Cloudflare R2)

Para retención a largo plazo y archivado de particiones mensuales de entregas (`delivery_attempts`):

### Configuración en Supabase Storage
1. Registrarse en [supabase.com](https://supabase.com).
2. Crear un proyecto llamado `hookrelay-storage`.
3. Navegar a **Storage** → **New Bucket**:
   - **Bucket name:** `hookrelay-cold-archives`
   - **Public bucket:** Desactivado (Privado).
4. Navegar a **Project Settings** → **Storage** y generar las **S3 Access Keys**:
   - Copiar **Endpoint URL** (ejemplo: `https://xyzproject.supabase.co/storage/v1/s3`).
   - Copiar **Access Key ID**.
   - Copiar **Secret Access Key**.
   - **Region:** `us-east-1` (o la región predeterminada del proyecto).

---

## 5. Paso 4: Despliegue del Backend en Render.com

Render aloja el contenedor Docker con la API NestJS y el worker BullMQ integrado.

### 5.1. Despliegue mediante Render Blueprint (Automático)
1. Registrarse en [render.com](https://render.com) vinculando la cuenta de GitHub.
2. Hacer clic en **New +** → **Blueprint**.
3. Seleccionar el repositorio `segundo-proyecto` (o `hookrelay`).
4. Render detectará automáticamente el archivo `render.yaml` de la raíz del repositorio.
5. Introducir los valores secretos solicitados en el formulario de Render:
   - `DATABASE_URL`: Cadena de conexión de Neon con `?sslmode=require`.
   - `REDIS_URL`: Cadena de conexión de Upstash con `rediss://`.
   - `AWS_ENDPOINT_URL`: Endpoint de Supabase Storage.
   - `AWS_ACCESS_KEY_ID`: Credencial de acceso S3.
   - `AWS_SECRET_ACCESS_KEY`: Clave secreta S3.
   - `DASHBOARD_URL`: URL asignada a tu dashboard en Vercel (se puede actualizar tras desplegar el frontend).
6. Hacer clic en **Apply**.

### 5.2. Despliegue Manual (Alternativo)
Si se prefiere configurar manualmente sin Blueprint:
1. En Render, hacer clic en **New +** → **Web Service**.
2. Conectar el repositorio de GitHub.
3. Configurar:
   - **Name:** `hookrelay-api`
   - **Region:** Oregon o Frankfurt (acorde a tu BD).
   - **Runtime:** `Docker`
   - **Build Context:** `./apps/api`
   - **Dockerfile Path:** `./apps/api/Dockerfile`
   - **Instance Type:** `Free`
   - **Health Check Path:** `/health`
4. Añadir las variables de entorno detalladas en el archivo `.env.production.example`.
5. Hacer clic en **Create Web Service**.

Una vez completada la compilación en los logs de Render, se verificará la salida:
```text
HookRelay Engine running on port 3000
```
La URL pública asignada tendrá la forma `https://hookrelay-api.onrender.com`.

---

## 6. Paso 5: Despliegue del Dashboard en Vercel

1. Registrarse en [vercel.com](https://vercel.com) con tu cuenta de GitHub.
2. Hacer clic en **Add New...** → **Project**.
3. Seleccionar el repositorio de HookRelay.
4. En la configuración del proyecto:
   - **Framework Preset:** `Next.js`
   - **Root Directory:** Editar y seleccionar `apps/dashboard`.
5. En la sección **Environment Variables**, añadir:
   - **Key:** `NEXT_PUBLIC_API_URL`
   - **Value:** `https://hookrelay-api.onrender.com` (la URL del backend de Render desplegado en el Paso 4, sin barra final).
6. Hacer clic en **Deploy**.
7. Vercel compilará la aplicación y generará la URL pública (ejemplo: `https://hookrelay-dashboard.vercel.app`).
8. Regresar al panel de Render y actualizar la variable `DASHBOARD_URL` con esta dirección para permitir las cabeceras CORS.

---

## 7. Paso 6: Keep-Alive Permanente con UptimeRobot ($0)

Los Web Services gratuitos de Render entran en reposo ("spin down") tras 15 minutos sin tráfico entrante, causando una latencia de arranque en frío de 30 a 50 segundos en la siguiente petición.

Para mantener la instancia permanentemente activa las 24 horas del día:
1. Registrarse en [uptimerobot.com](https://uptimerobot.com) (Plan gratuito de por vida sin tarjeta).
2. Hacer clic en **Add New Monitor**:
   - **Monitor Type:** `HTTP(s)`
   - **Friendly Name:** `HookRelay API Health`
   - **URL (or IP):** `https://hookrelay-api.onrender.com/health`
   - **Monitoring Interval:** `10 minutes` (o `5 minutes`)
3. Hacer clic en **Create Monitor**.

Con esta configuración, UptimeRobot ejecuta una petición liviana `GET /health` periódicamente, garantizando que el contenedor Docker permanezca activo, la cola BullMQ procese eventos en tiempo real y la latencia de respuesta se mantenga en niveles óptimos.

---

## 8. Verificación de Humo (Smoke Test Checklist)

Una vez completado el despliegue, ejecutar la siguiente lista de verificación técnica:

```markdown
- [ ] 1. Health Check HTTP:
      curl -i https://<render-url>/health
      Debe responder 200 OK con payload: {"status":"ok","timestamp":"..."}

- [ ] 2. Conectividad Dashboard:
      Acceder a https://<vercel-url> en el navegador.
      El indicador de estado en la cabecera debe mostrar "ONLINE" y latencia < 200ms.

- [ ] 3. Disparo de Evento en Demo Sandbox:
      Navegar a la pestaña "Demo Sandbox".
      Seleccionar el tópico "order.created", verificar el payload JSON y hacer clic en "Disparar Evento".
      Verificar en el visor de logs del receptor simulado la recepción del webhook con:
      - Cabecera X-Hub-Signature-256 válida.
      - Timestamp X-HookRelay-Timestamp dentro de la ventana de 5 minutos.
      - Estado 200 OK.

- [ ] 4. Resiliencia y Circuit Breaker:
      En el simulador del receptor, cambiar el modo de respuesta a "503 Error".
      Disparar 5 eventos consecutivos.
      Ir a la pestaña "Salud de Endpoints" y confirmar:
      - Aumento en la tasa de fallo.
      - El badge del endpoint transiciona a "OPEN" tras alcanzar el umbral de 5 fallos.

- [ ] 5. Recuperación y Replay:
      Restaurar el receptor simulado a "200 OK".
      Navegar a "Inspector de Entregas", seleccionar una entrega fallida en el drawer lateral.
      Hacer clic en el botón "Replay".
      Confirmar que la entrega se reencola con prioridad y pasa a estado "DELIVERED".
```

---

## 9. Resolución de Incidencias Comunes

### Error: `PrismaClientInitializationError: Can't reach database server`
- Verificar que la variable `DATABASE_URL` contenga el parámetro `?sslmode=require`.
- En Neon, confirmar que la rama computacional ("Compute endpoint") esté activa.

### Error: `ECONNREFUSED` al conectar con Redis
- Asegurarse de utilizar el prefijo `rediss://` (con doble `s`) para proveedores de nube con cifrado TLS activado.
- Validar que el puerto coincida con el asignado por Upstash (habitualmente `6379` o un puerto dinámico en Redis Cloud).

### Error de CORS en el navegador (`Cross-Origin Request Blocked`)
- Asegurarse de que `DASHBOARD_URL` en Render coincida exactamente con la URL de Vercel, incluyendo el protocolo `https://` y sin barra inclinada al final.
