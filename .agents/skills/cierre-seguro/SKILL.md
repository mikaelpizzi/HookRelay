---
name: cierre-seguro
description: Ejecuta validación de tipos, linting y commit semántico atómico. Activar SIEMPRE al terminar de programar o corregir cualquier archivo antes de responder al usuario.
---

# Protocolo de Cierre Seguro

## Cuándo activar
Después de **cualquier** modificación de código (creación, edición, corrección, refactorización).

## Pasos obligatorios (en orden)

### 1. Validar tipos TypeScript
```bash
npx tsc --noEmit
```
Si hay errores, corregirlos antes de continuar. No hacer commit con errores de tipos.

### 2. Ejecutar linter
```bash
npm run lint
```
Corregir warnings y errores. Si no existe el script `lint`, ejecutar `npx eslint src/ --ext .ts`.

### 3. Ejecutar tests del módulo tocado
```bash
npm run test -- --testPathPattern=<nombre-del-modulo>
```
Si no hay tests para el módulo, omitir este paso pero **documentar** en el mensaje de commit que no se validó con tests.

### 4. Revisar estado de Git
```bash
git status
```
- Verificar que NO se incluyan archivos `.env`, `node_modules/`, `dist/` ni archivos temporales.
- Si aparecen archivos no deseados, agregarlos a `.gitignore` primero.

### 5. Commit semántico atómico
```bash
git add .
git commit -m "tipo(alcance): descripción concisa en minúsculas"
```

Tipos válidos y cuándo usar cada uno:
- `feat(modulo)` — Funcionalidad nueva (endpoint, vista, servicio).
- `fix(modulo)` — Corrección de bug o error de lógica.
- `refactor(modulo)` — Reestructuración sin cambio funcional.
- `test(modulo)` — Nuevos tests o corrección de tests existentes.
- `docs(modulo)` — Cambios en documentación, README o comentarios.
- `chore(modulo)` — Configuración, dependencias, CI/CD, Docker.

### 6. Reportar al agente padre
Enviar un mensaje breve con:
- Qué se hizo (1-2 líneas).
- Hash abreviado del commit.
- Si hay tareas pendientes o decisiones que requieren input del usuario.
