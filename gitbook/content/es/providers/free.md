# Proveedores gratuitos - Respaldo de costo cero

El nivel gratuito es la última línea. Cuando las suscripciones están gastadas y el nivel barato está topado, estos proveedores siguen respondiendo — sin costo para ti.

Tres vienen listos para conectar: iFlow, Qwen y Kiro. Los tres usan cuentas que puedes crear gratis, y los tres tienen límites propios que fija el proveedor, no Vela.

---

## Resumen

- 🆓 **iFlow** — cuenta gratuita con un amplio menú de modelos: Qwen3, Kimi K2, DeepSeek, GLM y más
- 🆓 **Qwen** — los modelos de Qwen, en la propia plataforma de Qwen
- 🆓 **Kiro** — la familia Claude mediante un AWS Builder ID o un inicio de sesión social

**La idea:** pon uno de estos al final de cada combo. Entonces "todo está sin cuota" deja de ser una emergencia y se convierte en una tarde más lenta.

> **Sé honesto sobre "gratis".** Los niveles gratuitos están limitados por tasa, ocasionalmente no están disponibles, y cambian sin aviso. Los proveedores publican sus asignaciones; Vela muestra lo que tu cuenta tiene realmente disponible en la página **Quota**. Cualquier otra cosa — un titular como "180K solicitudes al mes" — es una cifra upstream que puede moverse.

---

## iFlow

### Qué obtienes

Un inicio de sesión, un menú. El proveedor que incluye esta versión:

| Modelo | Bueno para |
|-------|----------|
| `if/qwen3-coder-plus` | generación de código |
| `if/qwen3-max` | el modelo general Qwen3 más potente |
| `if/qwen3-235b-a22b-thinking-2507` | tareas con mucho razonamiento |
| `if/kimi-k2` | programación con contexto largo |
| `if/deepseek-r1` | razonamiento paso a paso |
| `if/deepseek-v3.2` | chat general rápido |
| `if/glm-4.7` | el mismo modelo del nivel barato, sin costo |
| `if/qwen3-vl-plus` | visión |

### Configuración

**Paso 1: conectar**

```
Dashboard → Providers → iFlow → Connect
```

**Paso 2: iniciar sesión**

El navegador abre la página de inicio de sesión de iFlow. Crea una cuenta si no tienes una, aprueba la conexión, y desde entonces Vela mantiene el token fresco.

Algunas cuentas de iFlow se autentican con una cookie de sesión en lugar de OAuth; si el dashboard ofrece un campo de cookie, pega el valor que pida.

**Paso 3: usarlo**

```
Model: if/qwen3-coder-plus
```

### Por qué es la primera opción gratuita

Variedad. Una sola cuenta alcanza modelos de varios fabricantes, lo que lo convierte en un buen valor por defecto cuando no quieres pensar en qué proveedor gratuito probar.

---

## Qwen

### Qué obtienes

Los modelos de Qwen, servidos por Qwen:

| Modelo | Bueno para |
|-------|----------|
| `qwen/qwen-max` | el modelo general más potente |
| `qwen/qwen-plus` | equilibrado |
| `qwen/qwen-turbo` | tareas rápidas y ligeras |
| `qwen/qwen-long` | documentos muy largos |

### Configuración

```
Dashboard → Providers → Qwen → Connect or Add API key
```

Según tu cuenta, eso es un inicio de sesión o una clave de la consola de Qwen. Luego usa los modelos como `qwen/qwen-plus`.

### Cuándo recurrir a él

- Cuando iFlow está limitado por tasa y necesitas algo ya.
- Para trabajo con documentos largos, donde `qwen/qwen-long` tiene ventaja.
- Como segundo peldaño de un combo solo gratuito.

---

## Kiro (Claude sin costo)

### Qué obtienes

La familia Claude a través de Kiro, que es el entorno de programación de AWS:

| Modelo | Bueno para |
|-------|----------|
| `kr/claude-sonnet-5` | el equilibrio de cada día |
| `kr/claude-sonnet-4.5` | una opción estable y probada |
| `kr/claude-opus-4.8`, `kr/claude-opus-5` | los problemas difíciles |
| `kr/claude-haiku-4.5` | tareas rápidas |

Cada uno tiene además variantes `-thinking` y `-agentic` (`kr/claude-sonnet-4.5-thinking`, y así sucesivamente) cuando quieres razonamiento visible.

### Configuración

**Paso 1: conectar**

```
Dashboard → Providers → Kiro → Connect
```

**Paso 2: elegir un inicio de sesión**

AWS Builder ID es la opción habitual; el proveedor también ofrece inicios de sesión con Google y GitHub.

**Paso 3: usarlo**

```
Model: kr/claude-sonnet-4.5
```

### Por qué es la opción de calidad

Es la misma familia de modelos que pagarías, a cambio de nada. Eso hace de `kr/...` la entrada natural de "gratis pero aún bueno" en un combo — la que usas para trabajo real en lugar de para experimentos.

---

## Lado a lado

| Proveedor | Prefijo | Modelos incluidos | Inicio de sesión | Destaca por |
|----------|--------|-----------------|-------|---------|
| **iFlow** | `if/` | 15 | OAuth o cookie | variedad |
| **Qwen** | `qwen/` | 4 | inicio de sesión o clave | documentos largos |
| **Kiro** | `kr/` | 44 | AWS Builder ID / social | calidad de Claude |

---

## Usarlos en tus herramientas

### Un modelo gratuito, directamente

```
Base URL: http://localhost:32060/v1
API Key:  [your Vela key]
Model:    kr/claude-sonnet-4.5
```

### Un combo solo gratuito

```
Dashboard → Combos → Create
  Name:   zero-cost
  Models: 1. kr/claude-sonnet-4.5      ← quality first
          2. if/qwen3-coder-plus        ← variety
          3. qwen/qwen-plus             ← last resort
```

Costo: nada, nunca. Velocidad y disponibilidad: lo que los niveles gratuitos permitan hoy.

### El combo completo de tres niveles

```
Dashboard → Combos → Create
  Name:   never-stuck
  Models: 1. cc/claude-opus-5          ← subscription
          2. cx/gpt-5.6-sol            ← second subscription
          3. glm/glm-4.7               ← cheap
          4. minimax/MiniMax-M2.1      ← cheaper
          5. kr/claude-sonnet-4.5      ← free, still good
          6. if/qwen3-coder-plus       ← free, variety
```

Esta es la cadena a la que apunta todo el diseño: usar lo que pagaste, pasar a lo barato y no terminar nunca en nada.

**Cómo funciona el fallback:** un combo pasa al siguiente modelo cuando una solicitud *falla* — error de cuota, límite de tasa, tiempo de espera agotado, prompt rechazado, modelo desconocido. No cambia de forma preventiva porque una asignación diaria esté bajando. Si quieres un techo estricto, fíjalo en la clave de API (**Endpoint & Key → budget**); entonces Vela se niega con un 429 en lugar de gastar en silencio.

---

## Sacar el máximo de los niveles gratuitos

### 1. Ponlos al final, y de verdad

Un modelo gratuito en primer lugar absorberá todo tu trabajo y dejará tu cuota de pago expirando sin usar. Un modelo gratuito al final no cuesta nada y salva el día.

### 2. Ajusta el modelo al trabajo

```
Reasoning / tricky code : if/qwen3-235b-a22b-thinking-2507, kr/claude-opus-4.8
Everyday coding         : kr/claude-sonnet-4.5, if/qwen3-coder-plus
Fast and cheap          : qwen/qwen-turbo, if/deepseek-v3.2
Long documents          : qwen/qwen-long
Vision                  : if/qwen3-vl-plus
```

### 3. No montes producción solo sobre ellos

Los niveles gratuitos cambian sin aviso: desaparece un modelo, se endurece un límite, un proveedor tiene una tarde mala. Úsalos como el suelo de una cadena, no como todo el plano.

### 4. Vigila la prioridad, no la cuota

Los niveles gratuitos a menudo aplican limitación por prioridad en lugar de rechazar directamente: tu solicitud espera detrás de los clientes que pagan. Si las respuestas se sienten lentas, normalmente es por eso, y cambiar a otro proveedor gratuito es la solución.

---

## Solución de problemas

### "OAuth failed"

- Comprueba que tienes conexión y que el sitio del proveedor carga en un navegador normal.
- Prueba otro navegador, o una ventana privada con las extensiones desactivadas.
- Desconecta y vuelve a conectar desde **Providers**.

### "Model not available"

- Confirma que el proveedor aparece como conectado en **Providers**.
- Confirma que el id del modelo es exactamente el que lista la puerta de enlace: `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`.

### "Slow responses"

Los niveles gratuitos tienen la prioridad más baja. Prueba otro proveedor gratuito, trabaja a horas más tranquilas, o deja que el combo siga adelante.

### "It worked yesterday and stopped today"

Esa es la naturaleza de un nivel gratuito. Reconecta, prueba otro modelo del mismo proveedor, o apóyate en otro proveedor gratuito hasta que vuelva.

---

## A dónde ir después

- **Empieza por las suscripciones:** [Proveedores de suscripción](subscription.md)
- **Añade un nivel intermedio barato:** [Proveedores baratos](cheap.md)
- **Construye y ajusta una cadena:** [Combos](../features/combos.md)
