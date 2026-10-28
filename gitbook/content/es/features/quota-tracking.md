# Seguimiento de cuota y monitoreo de uso

Vela guarda un recibo de todo. Esta página trata de leer esos recibos: cuánto queda de cada asignación, cuándo se reinicia, adónde va el dinero y cómo ponerle un techo estricto.

---

## Resumen

- **Consumo en vivo** — tokens y costo por solicitud, por modelo, por clave
- **Cuota y restante** — cuánto has usado de la asignación de cada proveedor
- **Cuentas regresivas de reinicio** — cuándo se vuelve a abrir la ventana
- **Estimaciones de costo** — calculadas con las tarifas que incluye Vela
- **Techos de presupuesto** — paradas estrictas, por clave de API
- **Historial** — hoy, 7, 14, 30, 60 días, o todo el tiempo

---

## Las salas del dashboard

```
Quota     per-provider allowances and reset times
Usage     requests, tokens, cost, by period, model, combo and key
Log Harbor   the request ledger, for when you need a single request
```

### Qué muestra la página Quota

Para cada proveedor conectado, una fila con:

- **Usado / total** — como barra y como porcentaje, cuando el proveedor publica un límite
- **Reinicio** — una cuenta regresiva hasta la siguiente ventana
- **Costo hasta ahora** — para los niveles medidos por uso

Los datos de cuota vienen de cada proveedor. Cuando un proveedor no publica una cifra utilizable, Vela muestra lo que puede medir (tu propio uso) y lo dice, en lugar de inventarse un porcentaje.

### Qué muestra la página Usage

- Solicitudes y tokens del periodo seleccionado
- Costo desglosado por modelo, combo y clave de API
- Qué modelo respondió realmente (mediante **Routed by Combo**)

---

## Seguimiento por solicitud

Cada solicitud queda registrada con su modelo, conteos de tokens, duración, resultado y costo. Cuando una factura te sorprende, aquí encuentras la solicitud que la causó.

Si quieres los cuerpos completos de solicitud y respuesta, activa `ENABLE_REQUEST_LOGS` — está desactivado por defecto porque ocupa mucho y contiene todo lo que enviaste.

---

## Cómo se comportan las distintas formas de cuota

Las cuotas no son una sola cosa. Los proveedores usan varias formas, y se reinician de manera distinta:

| Forma | Proveedores típicos | Cómo se reinicia |
|-------|-------------------|---------------|
| **Ventana móvil** | Claude Code, Codex | la ventana se desliza; la asignación vuelve a medida que el uso antiguo envejece |
| **Diario fijo** | algunos niveles baratos | a una hora fija, en la zona horaria del proveedor |
| **Mensual** | Copilot, planes | en una fecha, normalmente el día 1 o tu fecha de facturación |
| **Crédito medido** | GLM, MiniMax, la mayoría de claves de API | nunca "se reinicia" — es un saldo |

La consecuencia práctica: en una ventana móvil, esperar una hora puede bastar; en una ventana diaria fija, puede valer la pena dormir; en un saldo, solo pagar ayuda.

---

## Estimación de costos

Vela estima el costo a partir de `open-sse/providers/pricing.js`. Dos tarifas que importan sobre todo aquí:

| Modelo | Entrada /1M | Salida /1M |
|-------|-----------|------------|
| `glm/glm-4.7` | $0.60 | $2.20 |
| `minimax/MiniMax-M2.1` | $0.30 | $1.20 |

Como la salida cuesta entre tres y cuatro veces más que la entrada, una conversación con mucha salida cuesta mucho más que un prompt largo con una respuesta corta. Cuando una cifra parezca alta, mira el desglose antes de buscar un fallo.

Las estimaciones son estimaciones: un proveedor puede cambiar sus tarifas de venta al público antes de que la tabla de Vela se ponga al día. Tu factura es la que manda.

---

## Presupuestos y techos

Hay dos controles distintos, y se comportan de manera distinta. Vale la pena saber cuál tienes activado.

### Presupuesto por clave (la parada estricta)

```
Dashboard → Endpoint & Key → Create Key (or edit one)
  token budget:  daily / weekly / monthly / yearly
  spend cap:     in currency
```

Cuando una clave alcanza su techo, las solicitudes a través de esa clave se rechazan:

```
HTTP 429 — "Monthly spend cap exceeded: $20.00 of $20.00 used (budget_exceeded)"
```

Eso es un rechazo, no una redirección. Vela no te mueve a un modelo más barato para mantenerte bajo un tope; se detiene, porque "detenerse" es lo que pediste.

### Presupuestos de la puerta de enlace (umbrales suaves y topes estrictos)

Los presupuestos de uso pueden fijarse a nivel de puerta de enlace, clave o modelo, con ventanas de día, semana o mes. Emiten alertas al 50%, 80% y 100%, y deniegan sin más una vez superado un tope estricto — con un código que indica el ámbito.

### La diferencia con el fallback

Un combo pasa al siguiente modelo cuando una solicitud **falla**. Un presupuesto rechaza cuando has **gastado suficiente**. Ninguno de los dos ocurre por accidente, y ninguno adivina por ti.

---

## Leer tu propio uso desde la API

El dashboard lee de los mismos endpoints a los que puedes acceder tú:

```bash
# Usage summary
curl "http://localhost:32060/api/usage/stats?period=7d" \
  -H "Authorization: Bearer <key>"

# Request metrics over time (for charts)
curl "http://localhost:32060/api/usage/metrics/timeseries?period=7d" \
  -H "Authorization: Bearer <key>"

# Budget definitions
curl "http://localhost:32060/api/usage/budgets" \
  -H "Authorization: Bearer <key>"
```

Periodos válidos: `today`, `24h`, `7d`, `14d`, `30d`, `60d`, `all`. Son las mismas ventanas que usa el selector de periodo del dashboard, lo que los hace cómodos para un script semanal.

---

## Alertas

Se generan registros de alerta cuando un presupuesto cruza un umbral, y pueden entregarse a un banner del dashboard, a un webhook de Discord o a un webhook de n8n, según lo que tengas configurado.

Un correo de resumen mensual no es algo que Vela envíe por sí solo; si lo quieres, la API de arriba más un cron es un script de diez líneas.

---

## Buenas costumbres

### 1. Míralo una vez al día

La página **Quota** lleva diez segundos. Te cuenta más de tu semana que cualquier herramienta de productividad.

### 2. Pon techos a las claves que corren sin supervisión

Agentes, trabajos en segundo plano, cualquier cosa que haga bucles. Un techo que fijas una vez vence a una factura que lees una vez.

### 3. Dale a cada herramienta su propia clave

Así el informe de uso por clave significa algo de verdad.

### 4. Prefiere modelos más baratos para el trabajo aburrido

Un combo que pone GLM primero para "escribe un mensaje de commit" cuesta mucho menos que uno que lo envía a Opus, y responde igual de bien.

### 5. Trata las estimaciones como estimaciones

Se derivan de tarifas publicadas y conteos de tokens. Son suficientemente precisas para presupuestar, no para discutir con una factura.

---

## Solución de problemas

### La cuota muestra uso, pero las solicitudes fallan

Puede que el proveedor esté aplicando un límite que Vela no puede ver (un tope a nivel de cuenta, un límite de tasa por minuto). La cifra de cuota es una guía, no una promesa. Prueba otro modelo o consulta la página de estado del proveedor.

### Los costos se ven mal

1. Comprueba las tarifas: **Proveedores baratos** lista las que Vela incluye.
2. Comprueba el desglose — los tokens de salida dominan.
3. Comprueba el modelo — `-highspeed` y las variantes más grandes cuestan más.
4. Si un proveedor cambió sus precios, la estimación estará desviada hasta que se actualice la tabla.

### La cuenta regresiva del reinicio parece congelada

Recarga la página; los datos de cuota se obtienen al cargar. Si la cuenta regresiva en sí es errónea para un proveedor que publica su hora de reinicio, es un detalle upstream que Vela está mostrando, no calculando.

### Se alcanzó el presupuesto, pero quiero continuar

Edita el presupuesto de la clave en **Endpoint & Key**, o usa otra clave. El rechazo es el techo haciendo su trabajo.

---

## Relacionado

- [Enrutamiento inteligente](smart-routing.md) — adónde van las solicitudes, y por qué
- [Combos](combos.md) — las cadenas detrás de los costos
- [Proveedores baratos](../providers/cheap.md) — las tarifas en detalle
