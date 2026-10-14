# UADE-BOT — Dashboard de telemetría de robot

TP05 de **Desarrollo de Aplicaciones II** (UADE). Dashboard web en tiempo real
que muestra la telemetría de un robot Unitree (**Go2** o **G1**): ángulos de
motor, temperatura, torque, inclinación, batería y patas apoyadas.

Corre igual contra el simulador y contra el robot real: sólo cambia la IP.

## Características

- **Ángulos de motor** en el tiempo, con selector de motores (12 en el Go2, 29 en el G1).
- **Tabla de motores** con ángulo, velocidad, torque y temperatura (coloreada por calor) y alarma de torque configurable.
- **Inclinación**: horizonte artificial (roll/pitch), compás (yaw) y gráfico temporal.
- **Batería**: SOC, corriente, temperatura del BMS y voltaje por celda.
- **Patas apoyadas**: diagrama visto desde arriba (4 patas en el Go2; se oculta si el robot no las reporta).
- **KPIs**: modelo, cantidad de motores, temperatura y torque máximos, tiempo de simulación y mensajes/seg.
- Reconexión automática del WebSocket con backoff y validación previa contra `GET /telemetria`, con mensajes de error claros.

## Stack

- HTML + CSS + JavaScript sin frameworks
- [Chart.js](https://www.chartjs.org) 4.4.4 (incluido localmente en `mi_dashboard/`)
- Canvas 2D para el horizonte y el compás
- Backend provisto por la cátedra: Python (FastAPI + uvicorn) y simulador MuJoCo

## Estructura

```
UADE-BOT/
├── mi_dashboard/          # El dashboard (este es el trabajo del TP)
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── chart.umd.min.js
│   └── README.md          # Detalle de uso y paneles
├── entorno/               # Simulador y backend de la cátedra
│   ├── api/               # Servidor de telemetría (REST + WebSocket)
│   └── sim/               # Simulador MuJoCo (Go2 / G1)
├── INICIAR_TP05.bat       # Arranque en Windows
├── INICIAR_TP05.sh        # Arranque en Linux / macOS
├── API.md                 # Contrato de la API
├── INSTALACION.md         # Instalación del entorno
├── LEEME_ESTUDIANTE.md    # Guía del TP
└── LEEME_DOCENTE.md       # Guía docente
```

## Cómo correrlo

1. **Instalar el entorno** (una sola vez): seguí [INSTALACION.md](INSTALACION.md).
2. **Levantar simulador y backend**:
   - Windows: doble clic en `INICIAR_TP05.bat`
   - Linux / macOS: `INICIAR_TP05.sh`

   Elegí el robot (1 = G1, 2 = Go2) y anotá la dirección que muestra, por ejemplo `http://10.0.0.5:8001`. Dejá esa ventana abierta.
3. **Abrir el dashboard**: abrí `mi_dashboard/index.html` en el navegador (o, desde esa carpeta, `python -m http.server`).
4. Cargá **Host** y **Puerto** y apretá **Conectar**. La última dirección usada queda guardada.

Para usarlo con el robot real, ingresá la IP del robot en lugar de la del simulador.

## API utilizada

El dashboard sólo lee datos (no mueve el robot):

| Endpoint | Uso |
|---|---|
| `GET /telemetria` | Chequeo de conexión antes de abrir el socket |
| `WS /ws` | Telemetría en vivo (~10 Hz) |

El contrato completo está en [API.md](API.md).

## Nota sobre los datos

El simulador es cinemático: **ángulo, velocidad y yaw** son reales, pero
**torque, temperatura, roll/pitch, fuerzas de pata y batería** están derivados
del movimiento del robot. Son coherentes, pero no son mediciones; los umbrales
de alarma son ilustrativos y no deben usarse tal cual contra el robot real.

## Solución de problemas

- **No llega nada**: abrí `http://<IP>:8001/telemetria` en el navegador. Si no ves JSON, el problema está en el backend o el simulador.
- **Gráficos planos**: verificá que el robot esté caminando (que no se haya iniciado con `--sin-paseo`).
- **Se corta la conexión**: el dashboard reconecta solo; si sigue en rojo, probablemente se cerró la ventana del backend.

## Créditos

- Modelos del robot y puente con el SDK: [unitree_mujoco](https://github.com/unitreerobotics/unitree_mujoco) (ver `entorno/sim/unitree_mujoco/LICENSE`).
- Entorno de simulación y API: cátedra de Desarrollo de Aplicaciones II, UADE.
- Dashboard: Tomás Iñiguez.
