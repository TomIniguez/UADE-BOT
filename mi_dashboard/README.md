# TP05 — Dashboard de telemetría

Dashboard HTML + JS sin frameworks. Funciona igual contra el simulador y
contra el robot real: sólo cambiás la IP en el formulario de conexión.

## Cómo usarlo

1. Levantá el simulador (`INICIAR_TP05.*`) y anotá la IP:puerto que te muestra
   (por defecto `10.0.0.5:8001`).
2. Abrí `index.html` en el navegador. Podés abrirlo directo con doble clic,
   o servirlo con algo como `python -m http.server` desde esta carpeta si
   preferís no usar `file://`.
3. En el formulario de arriba, cargá el host y el puerto y apretá **Conectar**.
   El dashboard primero prueba `GET /telemetria` (para darte un error claro si
   algo anda mal) y después abre el WebSocket para los datos en vivo.

## Qué hace cada parte

- **Ángulos de motor**: elegís qué motores graficar con los chips (hay 12 en
  el Go2, 29 en el G1 — por eso no se grafican todos de entrada).
- **Tabla de motores**: ángulo, velocidad, torque y temperatura de cada uno,
  con color según temperatura y una fila resaltada si el torque supera el
  umbral que configurás arriba de la tabla.
- **Inclinación**: horizonte artificial (roll/pitch) + compás (yaw), más un
  gráfico de los tres en el tiempo.
- **Batería**: SOC, corriente, temperatura del BMS y voltaje por celda si el
  robot las reporta.
- **Patas apoyadas**: diagrama visto desde arriba. Se arma solo con las claves
  que vengan en `fuerzas` (soporta tanto el esquema `FR/FL/RR/RL` del Go2 como
  `R_foot/L_foot`), y el panel se oculta solo si el robot no reporta patas.

## Si algo no anda

- Nada llega → abrí `http://<IP>:8001/telemetria` en el navegador. El
  dashboard hace lo mismo al conectar y te muestra el error ahí arriba si
  falla.
- Todo plano → fijate que el robot se esté paseando en la ventana del
  simulador (no se haya arrancado con `--sin-paseo`).
- Se corta y no vuelve → el dashboard reconecta solo con backoff creciente;
  si después de un rato sigue en rojo, probablemente se cerró la ventana del
  backend.

## Nota sobre los datos

Torque, temperatura, roll/pitch, fuerzas de pata y batería están **derivados**
en el simulador (no son mediciones físicas). El umbral de alarma de torque de
la tabla es ilustrativo — contra el robot real estos valores van a ser otros.
