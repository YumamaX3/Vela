# Proveedores de suscripción - Maximiza tu valor

Ya estás pagando Claude Code, o Codex, o Copilot. El nivel de suscripción trata de aprovecharlo entero: saber cuánto queda, usarlo antes de que se reinicie, y seguir adelante con limpieza cuando se agote.

Esta página cubre los cinco proveedores que la gente conecta primero, cuánto cuesta cada uno aguas arriba, qué modelos puedes llamar hoy y cómo ponerlos a trabajar.

> **Aquí las fechas importan.** Los niveles de suscripción, los precios y los nombres de modelo los fijan Anthropic, OpenAI, GitHub y Google — no Vela. Las cifras de esta página son datos upstream a fecha de **2026-10-28** (Vela 1.2.4). Los proveedores los cambian a menudo.

---

## Resumen

El nivel de suscripción va **primero** porque el dinero ya está gastado:

- ✅ **Claude Code** (Pro/Max) — la familia Claude a través de tu suscripción de Anthropic
- ✅ **OpenAI Codex** (Plus/Pro) — la familia GPT-5.x a través de tu plan de ChatGPT
- ✅ **GitHub Copilot** — una suscripción, modelos de varios fabricantes
- ✅ **Antigravity** (Google) — modelos Gemini y Claude en tu cuenta de Google
- ✅ **Kimi** — el plan de programación de Moonshot, añadido con clave de API o inicio de sesión

**La idea:** úsalos primero, vigila la cuota en tiempo real, y ten un proveedor barato o gratuito esperando detrás.

---

## Claude Code (Pro/Max)

### Cuánto cuesta aguas arriba

| Plan | Precio mensual típico | Forma de la cuota | Modelos |
|------|----------------------|-------------|--------|
| Pro | unos $20 | ventana móvil más refresco semanal | Opus, Sonnet, Haiku |
| Max | unos $100 | ventana móvil mayor más refresco semanal | Opus, Sonnet, Haiku |

Esos son los precios de consumo publicados por Anthropic; consulta la página de tu propio plan para ver qué se aplica a ti.

### Configuración

> ⚠️ **Una advertencia que vale la pena decir de entrada.** En esta versión el proveedor de Claude Code (`claude`, alias `cc`) está marcado como **obsoleto, con un aviso de riesgo** en el registro. Se apoya en una interfaz de Claude Code no documentada, que Anthropic puede cambiar sin aviso. Hoy funciona — pero trátalo como un nivel que puede necesitar reparación, no como una garantía.

**Paso 1: conectar**

```
Dashboard → Providers → Claude → Connect
```

**Paso 2: iniciar sesión**

Se abre una ventana del navegador en la página de inicio de sesión de Claude. Aprueba la conexión. Los tokens se renuevan solos a partir de ese momento, y el seguimiento de cuota empieza de inmediato.

**Paso 3: usarlo**

Los modelos se nombran `cc/<model-id>`. Los que incluye esta versión:

| Modelo | Bueno para |
|-------|----------|
| `cc/claude-opus-5` | problemas difíciles, arquitectura, refactorizaciones largas |
| `cc/claude-sonnet-5` | trabajo del día a día, el valor por defecto sensato |
| `cc/claude-fable-5` | tareas con mucha escritura |
| `cc/claude-haiku-4-5-20251001` | ediciones rápidas, preguntas pequeñas |

> Las listas de modelos se mueven más rápido que la documentación. Ejecuta `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"` — o abre **Providers → Claude** — para ver exactamente lo que ofrece hoy tu instalación.

### Sacarle el máximo

- Pon Opus primero en un combo para trabajo de producción, y Sonnet primero para todo lo demás.
- Añade varias cuentas si las tienes; Vela puede rotar entre ellas.
- Mira la cuenta regresiva del reinicio en la página **Quota** en lugar de adivinar.

---

## OpenAI Codex (Plus/Pro)

### Cuánto cuesta aguas arriba

| Plan | Precio mensual típico | Forma de la cuota | Modelos |
|------|----------------------|-------------|--------|
| Plus | unos $20 | ventana móvil más refresco semanal | familia GPT-5.x |
| Pro | unos $200 | asignación mucho mayor | familia GPT-5.x |

### Configuración

**Paso 1: conectar**

```
Dashboard → Providers → Codex → Connect
```

**Paso 2: iniciar sesión**

El flujo OAuth se abre en tu navegador (en loopback; si el navegador no aparece en un servidor sin interfaz, copia la URL y complétala en tu portátil, luego pega la llamada de vuelta). Los tokens se renuevan automáticamente.

**Paso 3: usarlo**

| Modelo | Bueno para |
|-------|----------|
| `cx/gpt-5.6-sol` | el buque insignia actual para programación |
| `cx/gpt-5.6-terra` | una segunda opción moderna |
| `cx/gpt-5.6-luna` | trabajo rápido y más ligero |
| `cx/gpt-5.5`, `cx/gpt-5.4` | respaldos estables |

Cada modelo tiene además un hermano `-review` (por ejemplo `cx/gpt-5.6-sol-review`) que se nutre de una familia de cuota aparte; útil saberlo cuando el nivel principal está apretado.

### Sacarle el máximo

- Codex y Claude responden bien a tipos distintos de preguntas. Un combo `cc/claude-opus-5 → cx/gpt-5.6-sol` es una pareja fuerte.
- El nivel Pro es más o menos diez veces la asignación de Plus — vale la pena solo si agotas Plus con regularidad.

---

## GitHub Copilot

### Cuánto cuesta aguas arriba

| Plan | Precio mensual típico | Reinicio | Modelos |
|------|----------------------|-------|--------|
| Individual | unos $10 | mensual | varios fabricantes |
| Business | unos $19 por asiento | mensual | varios fabricantes |

### Configuración

**Paso 1: conectar**

```
Dashboard → Providers → GitHub → Connect
```

**Paso 2: autorizar**

Inicia sesión en GitHub y aprueba la autorización de Copilot. Vela mantiene el token fresco.

**Paso 3: usarlo**

Los modelos se nombran `gh/<model-id>`, por ejemplo:

- `gh/claude-sonnet-4.6`, `gh/claude-opus-4.7`, `gh/claude-haiku-4.5`
- `gh/gpt-5.4`, `gh/gpt-5.3-codex`, `gh/gpt-5.2-codex`
- `gh/gemini-3.1-pro-preview`, `gh/gemini-3-flash-preview`

### Sacarle el máximo

- Copilot es el raro: **una suscripción, varios fabricantes**. Es una buena segunda o tercera entrada en un combo cuando quieres variedad sin una segunda factura.
- Su reinicio mensual hace que convenga guardarlo de reserva para el final del mes, cuando otros niveles están secos.

---

## Antigravity (cuenta de Google)

### Cuánto cuesta aguas arriba

Antigravity es el entorno de programación agéntica de Google. Es gratuito con una cuenta de Google, con su propia cuota, y expone modelos tanto Gemini como Claude.

### Configuración

**Paso 1: conectar**

```
Dashboard → Providers → Antigravity → Connect
```

**Paso 2: iniciar sesión con Google**

Aprueba la conexión, y luego usa modelos llamados `ag/<model-id>`:

- `ag/gemini-4-argon-high` (y `-medium`, `-low` para variantes más baratas y rápidas)
- `ag/gemini-3.8-flash`, `ag/gemini-3.7-flash`, y otras generaciones Gemini
- Modelos Claude, donde tu cuenta los ofrezca

### Sacarle el máximo

- El sufijo `-high`/`-medium`/`-low` es una palanca de costo real: la misma familia de modelos, un gasto de tokens muy distinto.
- Como es gratuito, pertenece a lo alto de un combo para cualquier cosa experimental.

---

## Kimi (Moonshot)

### Cuánto cuesta aguas arriba

Moonshot vende planes de programación directamente. Vela puede llegar a ellos con inicio de sesión o con clave de API, según lo que admita tu cuenta.

### Configuración

```
Dashboard → Providers → Kimi → Connect (login)   — or —   Add API key
```

Los modelos se nombran `kimi/<model-id>`: `kimi/kimi-latest`, `kimi/kimi-k2.5`, `kimi/k3`, `kimi/kimi-for-coding`.

---

## Lado a lado

| Proveedor | Mensual (upstream) | Cómo inicias sesión | Reinicio | Lo destacado |
|----------|--------------------|----------------|-------|----------|
| **Claude Code Pro** | unos $20 | OAuth | móvil + semanal | la mejor calidad en código extenso |
| **Claude Code Max** | unos $100 | OAuth | móvil + semanal | la mayor asignación de Claude |
| **Codex Plus** | unos $20 | OAuth | móvil + semanal | el modelo de programación más fuerte para un solo propósito |
| **Codex Pro** | unos $200 | OAuth | móvil + semanal | ~10× Plus |
| **GitHub Copilot** | unos $10–19 | OAuth | mensual | varios fabricantes, una factura |
| **Antigravity** | **gratis** | Google OAuth | el suyo propio | Gemini + Claude sin costo |
| **Kimi** | según el plan | inicio de sesión o clave | mensual | programación con contexto largo |

---

## Un ejemplo resuelto

**Cursor, Cline o cualquier herramienta compatible con OpenAI.**

Si tienes un combo llamado `premium-coding` (Claude primero, GLM segundo, Kiro al final):

```
Settings → Models
  Base URL: http://localhost:32060/v1
  API Key:  [your Vela key]
  Model:    premium-coding
```

Si quieres solo la suscripción, sáltate los combos y usa `cc/claude-opus-5` directamente.

**Construir el combo:**

```
Dashboard → Combos → Create
  Name:   premium-coding
  Models: 1. cc/claude-opus-5      ← subscription
          2. glm/glm-4.7           ← cheap
          3. kr/claude-sonnet-4.5  ← free last line
```

---

## Vigilar la cuota

La página **Quota** muestra, por proveedor:

- cuánto de la ventana está usado, como barra y como porcentaje
- cuándo se reinicia, como cuenta regresiva
- para los niveles de pago, cuánto ha costado hasta ahora

La página **Usage** muestra el mismo gasto por modelo, combo y clave de API, durante hoy, 7, 14, 30 y 60 días, o todo el tiempo.

---

## Buenas prácticas

### 1. Gratis y barato primero, si el objetivo es el costo

```
1. Antigravity (free Claude / Gemini)
2. Claude Code or Codex (you already pay)
3. GLM-4.7 (cheap)
4. iFlow or Kiro (free)
```

Si el objetivo es la *calidad en los problemas difíciles*, pon la suscripción primero — no hay un orden universalmente correcto, solo el que encaja con lo que haces esta semana.

### 2. Mira los tiempos de reinicio

Las ventanas móviles se reinician unas horas después del primer uso; las diarias y las mensuales se reinician a horas fijas. El trabajo pesado el día antes de un reinicio mensual es cuota gastada para nada.

### 3. Usa un combo, y pon un proveedor gratuito al final

Un combo que termina en un nivel gratuito nunca te deja atascado a mitad de una idea.

---

## Solución de problemas

### "Quota exhausted"

Espera el reinicio (mira la cuenta regresiva), o deja que el combo pase al siguiente modelo. Nada más está roto.

### "OAuth token expired"

Vela renueva los tokens automáticamente; un mensaje de caducidad normalmente significa que la renovación en sí falló. Ve a **Providers → [proveedor] → Disconnect**, y luego a **Connect** de nuevo.

### Límite de tasa mientras la cuota parece disponible

Los límites de tasa y la cuota son límites distintos. Un proveedor puede rechazar solicitudes por una ráfaga aun con asignación restante; la cadena de fallback es la respuesta, no esperar.

### Se rechaza un nombre de modelo

Puede que el modelo se haya renombrado aguas arriba. Pregunta a la puerta de enlace qué tiene en realidad:

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>" | grep claude
```

---

## A dónde ir después

- **Respaldo barato:** [Proveedores baratos](cheap.md)
- **Fallback gratuito:** [Proveedores gratuitos](free.md)
- **Construir una cadena:** [Combos](../features/combos.md)
