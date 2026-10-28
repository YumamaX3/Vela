# Bienvenido a Vela

**Usa Claude, Codex y Gemini a través de un solo endpoint — y luego sigue programando con respaldos baratos o gratuitos cuando se agote tu suscripción.**

Vela es una pequeña puerta de enlace que se sitúa entre tus herramientas de programación y tus proveedores de IA. Apuntas todas las herramientas a una sola dirección, y Vela decide qué proveedor responde cada solicitud — primero aquel cuya cuota ya pagaste, después uno barato, y al final uno gratuito.

Si alguna vez viste expirar sin usar un mes de cuota de Claude Code, o perdiste una hora por un límite de tasa en mitad de una refactorización, Vela está hecha para esa tarde.

---

## ¿Qué es Vela, en palabras simples?

Tus herramientas de programación (Cursor, Cline, Continue, Claude Code, Codex y decenas más) hablan todas "compatible con OpenAI": les das una URL base y una clave, y conversan con lo que sea que responda allí.

Vela responde allí. Detrás de ella están los proveedores que conectas — tu inicio de sesión de Claude Code, tu inicio de sesión de Codex, una clave de GLM, una cuenta gratuita de Kiro — y Vela enruta cada solicitud a la que deba atenderla.

**Lo que esto resuelve:**
- ❌ La cuota de suscripción expira sin usar cada mes
- ❌ Los límites de tasa te detienen a mitad de una frase
- ❌ Varias APIs de pago, cada una con su propia factura mensual
- ❌ Cambiar las herramientas de proveedor a mano

**Lo que obtienes en su lugar:**
- ✅ **Suscripciones usadas hasta el último token** — Claude Code, Codex, Copilot y compañía, rastreadas en tiempo real
- ✅ **Respaldos baratos** — GLM-4.7 a $0.60 / $2.20 por 1M tokens, MiniMax M2.1 a $0.30 / $1.20
- ✅ **Respaldos gratuitos** — iFlow, Qwen y Kiro, que no cuestan nada
- ✅ **Fallback automático** — cuando uno se agota, el siguiente toma el relevo sin que lo notes

---

## Características clave

### 🔄 Tres niveles, un endpoint

Configuras el orden una vez y sigues programando:

```
Tier 1 (SUBSCRIPTION): Claude Code → Codex → Copilot
  ↓ quota exhausted
Tier 2 (CHEAP):        GLM-4.7 → MiniMax M2.1 → Kimi
  ↓ spend cap reached
Tier 3 (FREE):         iFlow → Qwen → Kiro

→ The next one answers. You keep typing.
```

Los niveles 2 y 3 no son automáticos a menos que los construyas. Un **combo** es la forma de nombrar la cadena; la [guía de Combos](features/combos.md) explica cómo crear uno en unos pocos clics.

### 📊 Seguimiento de cuota

- Consumo de tokens por proveedor, en vivo
- Cuentas regresivas de reinicio (por hora, diario, semanal, mensual)
- Estimaciones de costo para los niveles de pago
- Techos de presupuesto por clave de API, si quieres límites estrictos

### 🎯 Funciona con cualquier herramienta compatible con OpenAI

✅ **Cursor** • **Cline** • **Claude Code** • **Codex CLI** • **Roo** • **Continue** • **cualquier otra que acepte una URL base**

### 💰 Un mes realista

Un desarrollador con 100M tokens al mes, en su mayoría mediante cuota que ya posee:

```
60M via Gemini CLI        : $0   (free allowance, upstream figure)
30M via Claude Code       : $0   (subscription you already pay for)
 8M via GLM-4.7            : about $4.80
 2M via MiniMax M2.1       : about $0.40
```

La [página de proveedores baratos](providers/cheap.md) desarrolla estos números línea por línea.

---

## ¿Cuántos proveedores soporta Vela?

La respuesta honesta son tres números, porque miden tres cosas distintas. Los tres se midieron el 2026-10-28 en la versión 1.2.4, y puedes volver a derivarlos en cualquier momento:

| Cantidad | Qué significa | Cómo comprobarlo tú mismo |
|-|-|-|
| **186** | archivos de proveedor en el registro — todo lo que alguien haya escrito | `ls open-sse/providers/registry/*.js \| grep -v index.js \| wc -l` |
| **186** | entradas que la aplicación puede ver realmente (hoy se importa cada archivo) | `node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"` |
| **145** | transportes que una solicitud puede alcanzar de verdad | `node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"` |

Así que: **145 proveedores a los que puedes marcar**, de los 186 que el registro conoce. Los 41 restantes son entradas que existen en el papel pero no declaran ningún transporte — medios, herramientas o trabajo en curso. Ejecuta los comandos anteriores en tu clon y obtendrás los números de hoy, no los del mes que viene.

Por su forma de autenticarse, los 186 se dividen en 131 proveedores con clave de API, 23 inicios de sesión OAuth, 22 niveles gratuitos, 7 proveedores con cookie web y 3 sin cuenta alguna. No necesitas recordarlo — la sala **Providers** del dashboard los lista.

---

## Por qué la gente elige Vela

### Obtén todo el valor de lo que ya pagas

¿Ya tienes Claude Code o Codex? Vela rastrea cuánta de esa cuota queda, alterna entre cuentas y mantiene una cuenta regresiva hasta el reinicio. El objetivo es simple: usar lo que compraste antes de que expire.

### Barato cuando lo bueno se agota

| Proveedor | Por 1M tokens | Reinicio típico |
|----------|---------------|---------------|
| **GLM-4.7** | $0.60 entrada / $2.20 salida | diario |
| **MiniMax M2.1** | $0.30 entrada / $1.20 salida | ventana móvil |
| **Kimi** | planes de suscripción | mensual |

Estas son las tarifas que Vela usa para sus estimaciones de costo (`open-sse/providers/pricing.js`); la factura de tu proveedor es la palabra final.

### Gratis cuando todo lo demás está gastado

- **iFlow** — cuenta gratuita, muchos modelos (Qwen3, Kimi K2, GLM 4.7, DeepSeek y más)
- **Qwen** — modelos Qwen en la propia cuenta de Qwen
- **Kiro** — modelos Claude mediante un AWS Builder ID

Los niveles gratuitos tienen límites de tasa, y cambian sin aviso. Son la última línea, no la primera.

---

## Inicio rápido

Dos minutos, si tienes Node.js 20 o superior instalado:

```bash
# The launcher installs itself and starts the gateway
npm install -g vela
vela
```

El dashboard se abre solo en **http://localhost:32060/dashboard**. No hay contraseña por defecto: un navegador local entra directamente, y los inicios de sesión remotos permanecen cerrados hasta que configures una contraseña en **Settings → Access**.

Luego, en cualquier herramienta de programación:

```
Endpoint: http://localhost:32060/v1
API Key:  [create one under Dashboard → Endpoint & Key → Create Key]
Model:    cc/claude-opus-5        (or any model, or a combo name)
```

[→ Guía completa para empezar](getting-started/quick-start.md)

---

## Para qué la usa la gente

### Desarrolladores independientes
Ejecuta todas tus herramientas contra un solo endpoint, deja que las suscripciones vayan primero y deja de pagar crédito de API adicional "por si acaso".

### Equipos pequeños
Ejecuta Vela una vez en un servidor pequeño, entrega una clave de API por persona con su propio techo de gasto, y vigila el uso en un solo lugar.

### Programar desde más de una máquina
Despliega Vela en un VPS o un contenedor y accede desde un portátil, una tableta o un teléfono. [La guía de la nube](deployment/cloud.md) lo cubre, incluido el proxy inverso que necesitarás.

---

## A dónde ir después

- [Inicio rápido](getting-started/quick-start.md) — en marcha en cinco minutos
- [Instalación](getting-started/installation.md) — todos los métodos de instalación, en detalle
- [Proveedores](providers/subscription.md) — los tres niveles explicados: suscripción, barato, gratis
- [Funciones](features/smart-routing.md) — enrutamiento, combos, seguimiento de cuota
- [Integración](integration/claude-code.md) — conectar tus herramientas
- [Despliegue](deployment/localhost.md) — local, nube, Docker
- [Preguntas frecuentes](faq.md) — respuestas breves a las dudas habituales

---

<div align="center">
  <sub>Hecho para desarrolladores que prefieren programar antes que vigilar sus facturas de API.</sub>
</div>
