# Combos - Cadenas de fallback personalizadas

Un combo es un nombre para una cadena de modelos. Dale un nombre una vez, y cada herramienta puede pedir ese nombre en lugar de un modelo concreto — y cuando un modelo de la cadena queda fuera de alcance, responde el siguiente.

Los combos son los cinco minutos más útiles que pasarás con Vela.

---

## Qué es un combo

```
Name: premium-coding
Models:
  1. cc/claude-opus-5          ← try first
  2. glm/glm-4.7               ← if #1 is out
  3. kr/claude-sonnet-4.5      ← if #2 is out too
```

Luego cualquier herramienta pide `premium-coding` como si fuera un nombre de modelo. Vela resuelve los nombres de combo **antes** que cualquier otra cosa, así que `premium-coding` nunca chocará con un prefijo de proveedor.

### Cuándo avanza la cadena

Un combo pasa al siguiente modelo cuando una solicitud **falla**:

- el proveedor informa un error de cuota o de límite de tasa
- la solicitud agota su tiempo de espera
- el proveedor rechaza el prompt por motivos de política
- el id del modelo es desconocido o no está disponible

### Cuándo no avanza

- Una asignación diaria que solo está bajando **no** provoca un cambio. Vela no te moverá en silencio a un modelo de pago porque estés cerca de un límite — eso sería gastar tu dinero por ti.
- Un techo de gasto estricto pertenece a la clave de API (**Endpoint & Key → budget**); cuando se alcanza, Vela se niega con un 429 en lugar de desviarte a otro sitio.

---

## Por qué usarlos

### 1. Obtén valor de tus suscripciones
```
cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5
```
Usa primero lo que ya pagas, barato después, gratis al final.

### 2. Mantén bajos los costos
```
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/qwen3-coder-plus
```
$0.60 → $0.30 → gratis, por 1M de tokens de entrada.

### 3. No te quedes nunca atascado
```
cc/claude-opus-5 → cx/gpt-5.6-sol → glm/glm-4.7 → if/qwen3-coder-plus
```
Termina siempre la cadena en algo gratuito, o estarás a una cuota agotada de distancia de una tarde detenida.

### 4. Mantén la calidad cuando importa
```
cc/claude-opus-5 → cx/gpt-5.6-sol → ag/gemini-4-argon-high
```
Modelos premium de principio a fin. Cuesta más, nunca se apaga.

---

## Crear uno

### Paso 1: abrir el dashboard

```
http://localhost:32060/dashboard → Combos
```

### Paso 2: crear

```
Combos → Create
  Combo Name: premium-coding
  Models:     add them one at a time, in priority order
```

Arrastra las filas para reordenarlas. El modelo de arriba se prueba primero.

### Paso 3: guardar

El combo aparece de inmediato, y la puerta de enlace lo resolverá en la siguiente solicitud — sin necesidad de reiniciar.

### Paso 4: usarlo

```
Model: premium-coding
```

Esa es toda la interfaz. Cualquier herramienta que acepte un nombre de modelo acepta el nombre de un combo.

### Una segunda estrategia: round-robin

Un combo también puede rotar entre sus miembros en lugar de ir cayendo por ellos. Configúralo globalmente en **Settings → Routing → Combo round robin**, si tu objetivo es repartir carga (por ejemplo, entre varias cuentas) en lugar de hacer fallback.

---

## Ejemplos resueltos

### Ejemplo 1: premium pero frugal

```
premium-coding
  1. cc/claude-opus-5
  2. glm/glm-4.7
  3. minimax/MiniMax-M2.1
```

Un mes típico con 100M de tokens:

```
80M via the Claude subscription : $0
15M via GLM-4.7                 : about $9
 5M via MiniMax M2.1            : about $1
```

El modelo caro hace el trabajo real; los baratos absorben el desbordamiento.

### Ejemplo 2: solo presupuesto

```
budget-combo
  1. glm/glm-4.7
  2. minimax/MiniMax-M2.1
  3. if/qwen3-coder-plus
```

Con 100M de tokens al mes, repartidos 70 / 20 / 10:

```
70M via GLM          : about $42
20M via MiniMax      : about $4
10M via iFlow        : $0
```

Cuesta dinero, pero nada parecido a la factura de una API de venta al público.

### Ejemplo 3: costo cero

```
free-combo
  1. kr/claude-sonnet-4.5
  2. if/qwen3-coder-plus
  3. qwen/qwen-plus
```

Costo: $0. Restricciones: lo que los niveles gratuitos opinen de ti hoy.

### Ejemplo 4: calidad primero

```
quality-first
  1. cc/claude-opus-5
  2. cx/gpt-5.6-sol
  3. ag/gemini-4-argon-high
```

Sin respaldo barato, a propósito: si los tres están gastados, falla en voz alta en lugar de producir en silencio un trabajo más flojo.

### Ejemplo 5: todos los niveles, en orden

```
never-stuck
  1. ag/gemini-4-argon-high     ← free, surprisingly strong
  2. cc/claude-opus-5           ← subscription
  3. cx/gpt-5.6-sol             ← second subscription
  4. gh/claude-sonnet-4.6       ← third
  5. glm/glm-4.7                ← cheap
  6. minimax/MiniMax-M2.1       ← cheaper
  7. kr/claude-sonnet-4.5       ← free, good quality
  8. if/qwen3-coder-plus        ← free, variety
```

Ocho peldaños, cada uno más barato que el anterior, y ninguno de ellos sin nada que perder.

---

## Usar un combo en cada herramienta

### Cursor

```
Settings → Models → OpenAI API
  Base URL: http://localhost:32060/v1
  API Key:  [your Vela key]
  Model:    premium-coding   (add as a custom model)
```

### Claude Code

```bash
export ANTHROPIC_BASE_URL="http://localhost:32060/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
claude --model premium-coding
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:32060/v1"
export OPENAI_API_KEY="[your Vela key]"
codex --model premium-coding "your prompt"
```

### Cline / Roo / Continue

```
Provider: OpenAI Compatible
Base URL: http://localhost:32060/v1
API Key:  [your Vela key]
Model:    premium-coding
```

### Desde un script

```bash
curl http://localhost:32060/v1/chat/completions \
  -H "Authorization: Bearer [your Vela key]" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "premium-coding",
    "messages": [{"role": "user", "content": "Write a function that reverses a linked list."}],
    "stream": true
  }'
```

---

## Buenas costumbres

### 1. Termina en algo gratuito

```
✅ cc/claude-opus-5 → glm/glm-4.7 → if/qwen3-coder-plus
❌ cc/claude-opus-5 → glm/glm-4.7
```

La segunda cadena tiene un precipicio al final.

### 2. Decide qué estás optimizando

- **Costo:** barato primero, gratis al final.
- **Calidad:** premium primero, barato al final.
- **Valor de suscripción:** suscripción primero, gratis al final.

No hay una respuesta universal, y el orden correcto cambia con la semana.

### 3. Ajusta el combo al trabajo

```
production code     : quality-first
everyday edits      : premium-coding
exploration         : budget-combo
other people's work : never-stuck
```

Puedes mantener varios y cambiar cambiando un solo campo en la herramienta.

### 4. Comprueba qué hizo la cadena en realidad

La página **Routed by Combo** muestra qué modelo respondió cada solicitud, así que un combo que siempre aterriza en el último peldaño es visible en lugar de misterioso.

### 5. Pon un techo a las claves compartidas

Para una clave usada por agentes o trabajos en segundo plano, fija un tope de gasto. Un combo puede llevarte por la cadena, pero no puede impedir que gastes; un presupuesto sí.

---

## Avanzado

### Estrategias por combo

Un mismo combo puede preferir round-robin en lugar del fallback estricto — útil cuando los miembros tienen la misma calidad y quieres repartir la carga. Configúralo en **Settings → Routing**.

### Desactivar un modelo temporalmente

Desactiva un modelo en la página de su proveedor en lugar de borrarlo de cada combo; el combo lo salta y conserva su forma para cuando lo vuelvas a activar.

### Importar y exportar

Los combos se pueden exportar e importar desde la página de Combos, que es la forma más sencilla de trasladar una configuración que funciona a una segunda máquina.

---

## Solución de problemas

### No se reconoce el nombre del combo

- Comprueba que el nombre esté escrito exactamente como se guardó (distingue mayúsculas y minúsculas).
- Reinicia la herramienta si almacena en caché su lista de modelos al arrancar.
- Confirma que el combo está guardado — debería aparecer en la lista de Combos.

### Siempre aterriza en el último modelo

Eso significa que los anteriores están fallando. Mira **Quota** y **Providers**: normalmente un token caducado, una asignación agotada o un proveedor caído.

### Cuesta más de lo esperado

- Mira **Routed by Combo** para ver con qué frecuencia cayó por la cadena.
- Lee las tarifas en [Proveedores baratos](../providers/cheap.md) — los tokens de salida cuestan 3–4× los de entrada en el nivel barato.
- Reordena: pon primero el miembro más barato si la calidad lo permite.

### Una solicitud falla en lugar de hacer fallback

Algunos fallos no se pueden reintentar en otro sitio — una solicitud malformada fallará igual en cada modelo. Lee el texto del error antes de suponer que la cadena está rota.

---

## Relacionado

- [Enrutamiento inteligente](smart-routing.md) — cómo una solicitud elige un proveedor
- [Seguimiento de cuota](quota-tracking.md) — leer el uso y el costo
- [Proveedores baratos](../providers/cheap.md) — los números detrás de las cadenas
