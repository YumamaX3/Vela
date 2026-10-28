# Enrutamiento inteligente y fallback automático

Vela no adivina. Cada solicitud va a algún sitio por una razón: el modelo que pediste, la cuenta que debería atenderla y — si eso falla — el siguiente en la fila.

Esta página explica cada pieza, para que cuando una solicitud acabe en un lugar inesperado sepas exactamente qué control girar.

---

## La forma de una solicitud

```
Your tool
   ↓  POST /v1/chat/completions, model: "premium-coding"
Vela
   ↓  is "premium-coding" a combo?      → yes: walk its chain
   ↓  otherwise: is it prefix/model?    → resolve provider + model
   ↓  which account for that provider?  → connection order, or round-robin
   ↓  does the API key allow it?        → key scope
   ↓  is the key within budget?         → 429 if not
   ↓  call the upstream
   ↓  failed?                           → next model in the chain (combos)
Reply
```

Nada en ese recorrido reordena tus prioridades en silencio. Si pediste un modelo de suscripción, lo obtienes o recibes un error — salvo que estés usando un combo, en cuyo caso obtienes el siguiente modelo que listaste.

---

## Fallback de combos

Un combo es el único mecanismo que mueve una solicitud a un modelo *distinto*:

```
cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5
```

Avanza cuando una solicitud falla — errores de cuota, límites de tasa, tiempos de espera agotados, rechazos por política, modelos desconocidos — y se queda donde está cuando una solicitud *podría* fallar más adelante. Las reglas completas, y cómo construir uno, están en [Combos](combos.md).

## Rotación de cuentas

Dentro de un mismo proveedor, varias conexiones pueden compartir el trabajo. **Settings → Routing** ofrece round-robin (repartir entre conexiones) o fill-first (usar una hasta que se queje), con un límite sticky que mantiene una conversación en la misma cuenta durante un tiempo. Así usas dos cuentas de Claude, o tres, sin pensarlo.

## Ámbito de clave y presupuesto

Cada clave de API puede limitarse a ciertos proveedores, modelos o combos, y recibir un presupuesto de tokens y un techo de gasto. Cuando se alcanza el techo, la solicitud se rechaza con un `429` que lleva un código `budget_exceeded` — una parada clara, no una degradación silenciosa.

---

## Para qué sirve cada nivel

**Suscripción — úsalo primero, si la calidad importa**
- Claude Code, Codex, Copilot, Antigravity, Kimi
- Ya pagas por estos; el objetivo es usar la asignación antes de que expire

**Barato — el medio**
- GLM-4.7 ($0.60 / $2.20 por 1M), MiniMax M2.1 ($0.30 / $1.20), planes de Kimi
- Una fracción del precio de una API de venta al público, y suficientemente bueno para casi todo

**Gratis — la última línea**
- iFlow, Qwen, Kiro
- Limitados por tasa y variables, pero no cuestan nada

---

## Verlo ocurrir

```
Dashboard → Usage        a live view of requests, tokens and cost
Dashboard → Quota        per provider: used, remaining, reset countdown
Dashboard → Routed by Combo   which model actually answered
Dashboard → Log Harbor   the request ledger, when you need the detail
```

Si un combo aterriza siempre en su último peldaño, **Quota** te mostrará por qué en segundos.

---

## Configuración que importa

### Estrategia de enrutamiento

```
Dashboard → Settings → Routing
  Round robin            spread requests across connections
  Sticky limit           how long one conversation stays on one connection
  Combo round robin      rotate through a combo's members instead of falling through
```

### Reglas de fallback

Más allá de los combos, Vela tiene **Fallback Rules** — reglas definidas por el operador en función de lo que salió mal:

- un código de estado HTTP concreto
- un prompt rechazado (política de contenido)
- una ventana de contexto demasiado pequeña
- un tiempo de espera agotado
- cualquier error, en general

Las reglas pueden encadenarse y probarse en un panel de simulación antes de activarse. Son la herramienta adecuada cuando "prueba ese otro modelo cuando ocurra *aquello*" es una política y no una preferencia. Las encontrarás en **Fallback Rules** en la barra lateral.

### Techos por clave

```
Dashboard → Endpoint & Key → Create Key / Edit
  rate limit, token budget, spend cap, provider/model scope
```

Este es el único mecanismo que detiene el gasto. Úsalo en cualquier clave que corra sin supervisión.

---

## Ejemplos

### Ejemplo 1: suscripción primero

```
Model: premium-coding
  1. cc/claude-opus-5
  2. glm/glm-4.7
  3. if/qwen3-coder-plus
```

Por la mañana: responde Claude. Por la tarde, cuando se cierra la ventana móvil: responde GLM. Por la noche, cuando la tarjeta se declina: responde iFlow. Tú sigues escribiendo.

### Ejemplo 2: con un techo de gasto

Dale a la clave un tope mensual de $20. Trabaja con GLM y MiniMax hasta alcanzarlo; a partir de ahí toda solicitud de pago se rechaza con un `429`, y los niveles gratuitos siguen respondiendo. Facturas predecibles, sin sorpresas.

### Ejemplo 3: solo suscripción

Un solo modelo y ningún combo. Si la ventana está cerrada, recibes el error del proveedor. Es deliberado: hay gente que prefiere esperar antes que gastar.

---

## Buenas costumbres

### 1. Deja que el trabajo duro vaya a la suscripción

Los modelos Opus y de la clase GPT-5.6 se ganan su precio en arquitectura y depuración. Los modelos baratos se lo ganan en el otro ochenta por ciento.

### 2. Termina en un nivel gratuito

Una cadena que termina en un modelo de pago termina en una puerta cerrada.

### 3. Mira los tiempos de reinicio, no solo los porcentajes

Las ventanas móviles y las ventanas fijas se comportan distinto. El trabajo pesado el día antes de un reinicio mensual es asignación tirada.

### 4. Una clave por herramienta o por persona

Los ámbitos y presupuestos son por clave. Una clave compartida significa un techo compartido y ninguna forma de saber quién gastó qué.

---

## Solución de problemas

### "No available provider" / "quota exhausted"

Comprueba **Quota** por una cuenta regresiva, y luego comprueba que el combo termina en un modelo gratuito. Si lo hace y los proveedores gratuitos también están agotados, es un día genuinamente malo aguas arriba, no un fallo local.

### No para de hacer fallback

- Mira el primer peldaño: un token OAuth caducado es la causa más común.
- Comprueba la página de estado del proveedor.
- Confirma que el id del modelo sigue existiendo (`/v1/models`).

### Los costos son más altos de lo que sugiere el combo

- Lee **Routed by Combo**: cayó más abajo en la cadena de lo que suponías.
- Recuerda que los tokens de salida cuestan varias veces más que los de entrada en todos los niveles.
- Busca modelos `-highspeed` o `glm-5.x` más grandes en la cadena.

### Una solicitud se rechaza con un 429

Lee el código de la respuesta: límite de tasa, ámbito de clave o presupuesto. Cada uno indica qué rechazó y por qué.

---

## Relacionado

- [Combos](combos.md) — construir las cadenas
- [Seguimiento de cuota](quota-tracking.md) — leer los números
- [Proveedores baratos](../providers/cheap.md) — las tarifas
