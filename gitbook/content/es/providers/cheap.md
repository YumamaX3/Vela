# Proveedores baratos - Respaldo ultraeconómico

Cuando se agota la cuota de suscripción, un buen modelo barato cuesta unos pocos dólares al día en lugar de unos pocos dólares a la hora. Esta página cubre los tres proveedores baratos que incluye Vela, las tarifas exactas que Vela usa para estimar el costo, y cómo colocarlos detrás de tus suscripciones.

> **Sobre los números.** Toda tarifa de esta página procede de `open-sse/providers/pricing.js` en esta versión (Vela 1.2.5). Es contra lo que Vela mismo calcula sus estimaciones de costo. La factura de tu proveedor sigue siendo la palabra final — las tarifas las fija el upstream y cambian sin aviso.

---

## Resumen

El nivel barato se sitúa **entre** las suscripciones y los proveedores gratuitos:

- 💰 **GLM-4.7** — $0.60 entrada / $2.20 salida por 1M tokens (`glm/glm-4.7`)
- 💰 **MiniMax M2.1** — $0.30 entrada / $1.20 salida por 1M tokens (`minimax/MiniMax-M2.1`)
- 💰 **Kimi** — planes de suscripción, para un uso estable con contexto largo (`kimi/...`)

**La idea:** cuando se cierra una ventana de suscripción, el nivel barato te mantiene trabajando a una fracción del precio de una API de venta al público — y un proveedor gratuito sigue al final de la fila para cuando incluso eso es demasiado.

---

## GLM-4.7

### Precios

| Concepto | Tarifa |
|------|------|
| Entrada | $0.60 por 1M tokens |
| Salida | $2.20 por 1M tokens |
| Entrada en caché | $0.11 por 1M tokens |

Esa es la tarifa que Vela contabiliza: aproximadamente un catorceavo de una API de venta al público típica de $20 por 1M en entrada, y alrededor de un décimo en salida.

**Ejemplo resuelto — 10M de tokens, mitad leídos y mitad escritos:**

```
Input:   5M × $0.60 = $3.00
Output:  5M × $2.20 = $11.00
Total:              $14.00
```

**Ejemplo resuelto — un día típico de programación, 8M tokens con una proporción 3:1 de lectura/escritura:**

```
Input:   6M × $0.60 = $3.60
Output:  2M × $2.20 = $4.40
Total:              $8.00
```

### Configuración

**Paso 1: obtener una clave**

Crea una cuenta con tu proveedor de GLM (Zhipu / Z.ai, según tu región) y genera una clave de API.

**Paso 2: añadirla a Vela**

```
Dashboard → Providers → GLM → Add API key → paste → Save
```

**Paso 3: usarlo**

```
Model: glm/glm-4.7
```

### Modelos de este nivel

| Modelo | Bueno para |
|-------|----------|
| `glm/glm-4.7` | el caballo de batalla por su valor: programación y tareas generales |
| `glm/glm-4.6v` | visión — leer capturas de pantalla y diagramas |
| `glm/glm-5`, `glm/glm-5.2`, `glm/glm-5.3` | más nuevos, más potentes y más caros |
| `glm/glm-5.3-flash` | visión, a un precio más bajo |

### Notas prácticas

- **El enrutamiento consciente de la caché se paga.** La tarifa de entrada en caché de GLM es un quinto de la tarifa de entrada nueva; las conversaciones largas que mantienen estable su prefijo cuestan mucho menos.
- **GLM tiene sus propias ventanas de cuota.** La página **Quota** del dashboard muestra la asignación que te queda y la cuenta regresiva del reinicio de tu cuenta.
- **Déjalo en segundo lugar, no primero**, a menos que estés optimizando deliberadamente por costo — Claude y Codex son mejores en los problemas genuinamente difíciles.

---

## MiniMax M2.1

### Precios

| Concepto | Tarifa |
|------|------|
| Entrada | $0.30 por 1M tokens |
| Salida | $1.20 por 1M tokens |
| Entrada en caché | $0.03 por 1M tokens |

Este es el nivel de pago más barato que incluye Vela, y un favorito para trabajo con contexto largo.

**Ejemplo resuelto — 10M de tokens, mitad leídos y mitad escritos:**

```
Input:   5M × $0.30 = $1.50
Output:  5M × $1.20 = $6.00
Total:              $7.50
```

**Ejemplo resuelto — un día típico de programación, 8M tokens con 3:1:**

```
Input:   6M × $0.30 = $1.80
Output:  2M × $1.20 = $2.40
Total:              $4.20
```

### Configuración

**Paso 1: obtener una clave** en la plataforma de MiniMax.

**Paso 2: añadirla**

```
Dashboard → Providers → MiniMax → Add API key → paste → Save
```

**Paso 3: usarlo**

```
Model: minimax/MiniMax-M2.1
```

### Modelos de este nivel

| Modelo | Notas |
|-------|-------|
| `minimax/MiniMax-M2.1` | la mejor opción por valor, $0.30 / $1.20 |
| `minimax/MiniMax-M2.5`, `minimax/MiniMax-M2.7` | generaciones más nuevas, misma tarifa de cabecera |
| `minimax/MiniMax-M2.5-highspeed` | nivel más rápido, $0.60 / $2.40 |
| `minimax/MiniMax-M3` | el buque insignia actual |
| `minimax/minimax-image-01`, `minimax/speech-2.8-hd` | servicios de imagen y voz |

### Notas prácticas

- **El contexto largo es la razón para elegirlo.** Los modelos MiniMax aceptan entradas muy grandes, lo que los hace un buen hogar para preguntas de archivo completo y de repositorio completo cuando tu ventana de suscripción está cerrada.
- **Ojo con las variantes `-highspeed`** — cuestan el doble. Valen la pena para trabajo interactivo, son un desperdicio para trabajos por lotes.

---

## Kimi (planificación plana)

### Precios

Kimi vende planes de programación en lugar de venta al público por token. Vela puede llegar a ellos con inicio de sesión o con clave de API, según lo que ofrezca tu cuenta.

**Por qué se gana un lugar:** para un uso estable y predecible, un plan mensual plano supera la facturación por token, y los modelos Kimi son fuertes en contexto largo.

### Configuración

```
Dashboard → Providers → Kimi → Connect (login)   — or —   Add API key
```

```
Model: kimi/kimi-latest
       kimi/kimi-k2.5
       kimi/k3
```

---

## Lado a lado

| Proveedor | Entrada /1M | Salida /1M | Forma | Mejor para |
|----------|-----------|------------|-------|----------|
| **GLM-4.7** | $0.60 | $2.20 | medida, ventanas de cuota propias | programación barata del día a día |
| **MiniMax M2.1** | $0.30 | $1.20 | medida | lo más barato, contexto largo |
| **Kimi** | basado en plan | basado en plan | suscripción | volumen estable |
| Una API de venta al público para comparar | unos $20 | unos $20 (o más) | medida | — |

Lee la tabla como "cuál probar primero cuando la suscripción se termina": MiniMax por costo, GLM por calidad por dólar, Kimi si ya tienes un plan.

---

## Poner el nivel a trabajar

### Cursor, Cline, Continue, Roo

```
Base URL: http://localhost:32060/v1
API Key:  [your Vela key]
Model:    glm/glm-4.7        (or minimax/MiniMax-M2.1, or a combo name)
```

### Un combo que empieza por lo barato

```
Dashboard → Combos → Create
  Name:   cheap-backup
  Models: 1. glm/glm-4.7
          2. minimax/MiniMax-M2.1
          3. if/qwen3-coder-plus      ← free last line
```

Usa `cheap-backup` donde vaya un nombre de modelo. Barato primero, más barato segundo, gratis al final.

### Un combo que empieza por la suscripción

```
  Models: 1. cc/claude-opus-5
          2. glm/glm-4.7
          3. minimax/MiniMax-M2.1
          4. kr/claude-sonnet-4.5     ← free last line
```

---

## Adónde va el dinero en realidad

### Un mes realista, 100M de tokens

```
60M via a free allowance    : $0     (upstream allowance, not Vela's)
30M via a subscription      : $0     (already paid)
 8M via GLM-4.7             : about $4.80  (input-weighted)
 2M via MiniMax M2.1        : about $0.40  (input-weighted)
```

El nivel barato rara vez es la factura. Es la póliza de seguro que te mantiene programando cuando la suscripción está seca.

### Fijar un techo

Si entregas una clave de API a una herramienta que corre sin supervisión, dale a la clave un tope de gasto:

```
Dashboard → Endpoint & Key → Create Key (or edit an existing one)
→ budget: daily / weekly / monthly token budget and spend cap
```

Cuando se alcanza el tope, Vela rechaza la solicitud con un 429 que lo indica. **No** te moverá en silencio a un modelo más barato — un tope de gasto es una parada estricta, por diseño.

---

## Solución de problemas

### "Quota exhausted" en un nivel barato

Cada proveedor tiene sus propias ventanas. Consulta **Quota** para ver la cuenta regresiva del reinicio, o deja que el combo pase al nivel gratuito.

### "API key invalid"

- Vuelve a pegar la clave — los espacios finales son el culpable habitual.
- Comprueba que la cuenta tiene crédito de verdad; una cuenta con saldo cero a menudo responde con un error que parece de autenticación.
- Regenera la clave si alguna vez se pegó en un lugar público.

### "Mi factura es más alta que la estimación"

- Vela estima con las tarifas de `pricing.js`; un proveedor puede cambiar sus tarifas de venta al público antes de que Vela las actualice.
- Los contextos largos y el trabajo con mucha salida cuestan mucho más que los prompts cortos — la salida cuesta 3–4× el precio de la entrada en este nivel.
- Las variantes `-highspeed` y `glm-5.x` son notablemente más caras que los modelos de cabecera.

### "Quiero lo más barato posible"

Pon MiniMax M2.1 primero, GLM segundo y un proveedor gratuito al final — y considera si Antigravity (gratis) debería ir simplemente primero.

---

## A dónde ir después

- **Añade una última línea gratuita:** [Proveedores gratuitos](free.md)
- **Empieza por las suscripciones:** [Proveedores de suscripción](subscription.md)
- **Construye y ajusta una cadena:** [Combos](../features/combos.md)
