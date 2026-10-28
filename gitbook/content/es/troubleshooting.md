# Solución de problemas

La mayoría de los problemas con Vela son una de cinco cosas: no está en ejecución, la clave es incorrecta, el nombre del modelo no existe, un proveedor se quedó sin cuota, o hay una red en medio estorbando.

Esta página los toma en el orden en que probablemente te los encuentres. Cada arreglo es algo que puedes comprobar en menos de un minuto.

---

## Primero, dos comprobaciones que resuelven la mitad de todo

```bash
# 1. Is the gateway alive?
curl http://localhost:32060/api/health
# → {"ok":true}

# 2. Can it see any models?
curl http://localhost:32060/v1/models -H "Authorization: Bearer <your key>"
```

- **Ninguna respuesta** → no está en ejecución, o está en otro puerto. Consulta [Conexión rechazada](#connection-refused).
- **Una respuesta, pero una lista de modelos vacía** → ningún proveedor está conectado. Consulta [Modelo no encontrado](#model-not-found).
- **Un `401`** → la clave. Consulta [Clave de API inválida](#api-key-invalid).
- **Un `429`** → cuota, límite de tasa o un presupuesto que tú fijaste. Consulta [Límites de tasa](#rate-limiting).

---

## "Language model did not provide messages"

**Qué significa:** la solicitud llegó a un proveedor y volvió vacía o rechazada.

**Causas:** cuota agotada, una conexión caducada, o un modelo que el servicio upstream ya no atiende.

**Soluciones:**

1. **Comprueba la asignación** — **Quota**, para ver la cantidad restante de este proveedor y la cuenta regresiva del reinicio.
2. **Comprueba la conexión** — **Providers**: una conexión OAuth caducada aparece como necesitada de atención. Desconecta, y luego vuelve a Conectar.
3. **Usa un combo** para que el siguiente modelo responda mientras investigas:

   ```
   cc/claude-opus-5 → glm/glm-4.7 → if/qwen3-coder-plus
   ```

---

## Límites de tasa {#rate-limiting}

**Qué significa:** `429 Too Many Requests`, a menudo con una pista de reintento.

**Causas:** la ventana de la suscripción está cerrada, se alcanzó un límite por minuto por una ráfaga, o se alcanzó un techo de presupuesto en tu clave.

**Soluciones:**

1. **Lee el código de la respuesta.** Un código `budget_exceeded` significa que fijaste un techo y lo alcanzaste — edítalo en **Endpoint & Key**. Un límite de tasa simple significa esperar o cambiar.
2. **Comprueba la cuenta regresiva del reinicio** en **Quota**.
3. **Reparte la carga** — **Settings → Routing → Round robin** entre varias cuentas del mismo proveedor.
4. **Usa el nivel barato** mientras la suscripción se recupera: `glm/glm-4.7`, `minimax/MiniMax-M2.1`.
5. **Reintenta con espera progresiva** en tu propio código — respeta la pista de reintento, no insistas a ciegas.

---

## Token OAuth caducado

**Qué significa:** `Unauthorized`, o un proveedor que funcionaba ayer y hoy no.

**Causas:** la renovación falló (el proveedor invalidó la sesión, la red se cayó a mitad de la renovación, o cambiaste la contraseña de la cuenta).

**Soluciones:**

1. **Reconecta:** **Providers → [proveedor] → Disconnect → Connect**, y completa el inicio de sesión de nuevo.
2. Si el proveedor muestra varias cuentas, comprueba que la correcta esté habilitada.
3. Para un servidor sin interfaz gráfica, completa el flujo OAuth en otra máquina y pega la llamada de vuelta (callback), si el proveedor lo permite.

---

## Conexión rechazada {#connection-refused}

**Qué significa:** `ECONNREFUSED`, o "Cannot connect to localhost:32060".

**Causas:** Vela no está en ejecución, está en otro puerto, o hay un cortafuegos en medio.

**Soluciones:**

```bash
# Start it
vela

# or, if it is running elsewhere
vela --port 8080

# Is anything listening?
lsof -i :32060            # macOS / Linux
netstat -ano | findstr :32060   # Windows
```

Comprueba que la URL base de tu herramienta termine en `/v1` — `http://localhost:32060` sin eso llegará al dashboard, no a la API.

Si te conectas desde otra máquina, recuerda que la escucha por defecto es `0.0.0.0`, pero un cortafuegos puede seguir bloqueándola; y si arrancaste con `--host 127.0.0.1`, solo esa máquina puede alcanzarla.

---

## El dashboard no se abre

**Qué significa:** `http://localhost:32060/dashboard` está en blanco, girando, o inalcanzable.

**Causas:** el puerto está ocupado, Vela se cayó, o la caché del navegador está obsoleta.

**Soluciones:**

1. **Comprueba el proceso** — `vela --log` muestra su salida. Si no hay nada en ejecución, arráncalo.
2. **Comprueba el puerto**:
   ```bash
   lsof -i :32060                               # macOS / Linux
   lsof -ti:32060 | xargs kill -9               # stop the squatter
   netstat -ano | findstr :32060                # Windows
   taskkill /PID <PID> /F
   ```
3. **Prueba una ventana privada** para descartar la caché o una extensión.
4. **¿Desde otra máquina?** Esa es la puerta de la contraseña. El acceso local está abierto; el acceso remoto se rechaza hasta que configures una contraseña en **Settings → Access**.

---

## Modelo no encontrado {#model-not-found}

**Qué significa:** `404` o "model not found".

**Causas:** un error de escritura, un proveedor que no está conectado, o un id de modelo que se renombró aguas arriba.

**Soluciones:**

1. **Pregunta a la puerta de enlace qué tiene:**
   ```bash
   curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
   ```
2. **Comprueba el formato** — `prefijo/modelo`, por ejemplo `glm/glm-4.7`, no `glm-4.7` a solas.
3. **Conecta el proveedor** al que pertenece el modelo.
4. **Las listas de modelos cambian.** Si un modelo funcionaba el mes pasado y hoy no, probablemente el proveedor retiró ese id. Elige uno actual de la lista de arriba.

---

## Respuestas lentas

**Qué significa:** las solicitudes tardan mucho en empezar a transmitir, o agotan el tiempo.

**Causas:** latencia del proveedor, contextos grandes, prioridad del nivel gratuito, o un proxy almacenando la transmisión en búfer.

**Soluciones:**

1. **Prueba un modelo más rápido** — `cc/claude-haiku-4-5-20251001`, `minimax/MiniMax-M2.5-highspeed`, `qwen/qwen-turbo`.
2. **Reduce el contexto** — recorta el historial, envía el archivo relevante en lugar del repositorio entero.
3. **Los niveles gratuitos son lentos bajo carga**, por diseño. Sube de nivel si importa.
4. **¿Detrás de un proxy?** La transmisión necesita el búfer desactivado:
   ```nginx
   proxy_buffering off;
   proxy_read_timeout 86400;
   ```
5. **Comprueba la red** entre tú y el proveedor.

---

## Clave de API inválida {#api-key-invalid}

**Qué significa:** `401 Unauthorized`.

**Causas:** una clave equivocada, un pegado truncado, una clave que fue eliminada, o `REQUIRE_API_KEY` activado sin enviar ninguna clave.

**Soluciones:**

1. **Crea una clave nueva:** **Endpoint & Key → Create Key**. Las claves se muestran una sola vez al crearlas y se almacenan solo como hash; no hay forma de consultar una antigua.
2. **Comprueba el formato** — las claves de Vela tienen la forma `vela-v1-<id>-<checksum>`. Una clave con el estilo antiguo `sk-...` es anterior a este formato y ya no se acepta.
3. **Comprueba la cabecera** — `Authorization: Bearer <key>`, sin espacios ni saltos de línea sueltos.
4. **Pruébala:**
   ```bash
   curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
   ```
5. **Si la clave tiene un ámbito**, confirma que el modelo que pides está dentro de él.

---

## "Invalid API key" del proveedor, no de Vela

**Qué significa:** Vela aceptó tu clave, pero el servicio upstream rechazó la credencial del proveedor.

**Soluciones:**

1. Vuelve a comprobar la clave de API o el inicio de sesión del proveedor en **Providers**.
2. Confirma que la cuenta upstream tiene crédito.
3. Regenera la clave upstream si pudo quedar expuesta.

---

## Todo funcionaba ayer

Es la forma más común de problema, y casi siempre está aguas arriba:

- un nivel gratuito endureció sus límites
- un proveedor retiró un id de modelo
- una sesión OAuth quedó invalidada
- un proveedor tuvo una caída

Consulta la página de estado del proveedor, reconéctalo en **Providers**, y deja que un combo te lleve hasta que se recupere.

---

## Todavía bloqueado

- Confirma tu versión: `npm list -g vela` (esta documentación cubre la 1.2.5).
- Mira **Log Harbor** para ver la solicitud exacta y su error.
- Busca en los [issues](https://github.com/YumamaX3/Vela/issues), y abre uno con tu versión, el texto del error y los pasos que lo produjeron.

---

## ¿Necesitas más ayuda?

- **GitHub Issues:** [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)
- **Documentación:** [vela.my.id/docs](https://vela.my.id/docs)
- **Preguntas frecuentes:** [faq.md](faq.md)
