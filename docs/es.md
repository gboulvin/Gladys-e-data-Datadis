# e-data (Datadis)

Esta integración trae a Gladys los suministros eléctricos de una cuenta de
[Datadis](https://datadis.es). Datadis es la plataforma gratuita de las
distribuidoras eléctricas españolas (i-DE, e-distribución, UFD, E-redes,
Viesgo…): ofrece el consumo horario, el maxímetro y el contrato de cada punto
de suministro (CUPS) de un titular.

Es una integración **en la nube**: solo lee Datadis a través de Internet. No
controla nada, y las lecturas llegan con **uno o dos días de retraso** (así
funciona Datadis: los datos del contador de un día se publican los días
siguientes).

## Antes de empezar

1. Cree una cuenta en [datadis.es](https://datadis.es/register) con el NIF/NIE
   del titular del suministro (basta con una cuenta de particular).
2. Inicie sesión una vez en datadis.es y compruebe que sus suministros
   aparecen.

## Configuración

1. Abra la pestaña **Configuración** de la integración.
2. Introduzca su **usuario (NIF/NIE)** y su **contraseña** de Datadis.
3. Opcional: **NIF autorizado** — solo para leer los suministros de otro
   titular que ha autorizado su cuenta en Datadis.
4. Ajustes opcionales:
   - **Intervalo de actualización** (horas, 12 por defecto, 6 como mínimo):
     frecuencia de lectura de Datadis, que rechaza las consultas idénticas
     demasiado frecuentes.
   - **Historial a importar** (meses, 3 por defecto, hasta 24): se lee en la
     primera sincronización de un suministro.
   - **Consumo diario elevado** (kWh, 0 = desactivado): umbral del disparador
     de escena del mismo nombre.
   - **Alarma de pico de potencia** (% de la potencia contratada, 90 por
     defecto).
5. Guarde y pulse **Probar la conexión**: se muestra el número de suministros
   encontrados.
6. Sus suministros aparecen en la pestaña **Descubrimiento**: añádalos.

## Qué obtiene

Un dispositivo por suministro, con el nombre de su dirección, con:

| Característica             | Descripción                                                               |
| -------------------------- | ------------------------------------------------------------------------- |
| Consumo                    | Consumo horario fechado, integrado en el seguimiento energético de Gladys |
| Consumo del último día     | Total del último día completo (kWh)                                       |
| Consumo del mes            | Total del mes en curso (kWh)                                              |
| Potencia máxima del mes    | Pico más alto del maxímetro en el mes (W)                                 |
| Potencia contratada        | Potencia contratada más alta del contrato (W)                             |
| Fecha de los últimos datos | Fecha de la lectura más reciente                                          |

## Acciones

- **Probar la conexión** — inicia sesión y lista los suministros, sin leer el
  consumo.
- **Actualizar los datos ahora** — lee Datadis inmediatamente.

## Escenas

La integración añade sus propias tarjetas al editor de escenas (Gladys 5.1 o
posterior):

Disparadores:

- **Nuevos datos diarios** — Datadis ha entregado un nuevo día completo.
  Variables: `{{triggerEvent.data.date}}`,
  `{{triggerEvent.data.consumption_kwh}}`.
- **Consumo diario elevado** — un día ha superado el umbral configurado.
  Variables: `date`, `consumption_kwh`, `threshold_kwh`.
- **Alarma de pico de potencia** — el maxímetro ha registrado un pico igual o
  superior a la parte configurada de la potencia contratada (riesgo de que
  salte el ICP o de penalizaciones por exceso de potencia). Variables: `date`,
  `time`, `max_power_w`, `contracted_power_w`, `percent`.
- **Error de Datadis** — no se ha podido leer Datadis (credenciales
  rechazadas, límite de consultas, servicio no disponible). Variables:
  `reason`, `message`.

Cada disparador puede limitarse a un suministro (o a una causa de error).

Acciones:

- **Actualizar los datos de Datadis** — lee Datadis ahora. Salidas:
  `success`, `supplies`.
- **Obtener el consumo** — consumo de un suministro en un periodo (último día
  disponible, últimos 7 o 30 días, mes actual o anterior). Salidas:
  `consumption_kwh`, `days`, `start_date`, `end_date`, `max_power_w` —
  úselas en un mensaje para recibir un resumen semanal o mensual.

## Panel

- **Suministro eléctrico** — un suministro: último día, mes en curso,
  indicador de potencia máxima frente a la contratada, los últimos 14 días en
  barras, distribuidora, comercializadora y estado de la conexión, con un
  botón **Actualizar**.
- **Suministros Datadis** — todos los suministros de la cuenta y el estado de
  la conexión.

## Solución de problemas

- **«Datadis ha rechazado el usuario o la contraseña»**: compruebe sus
  credenciales en datadis.es. El usuario es el NIF/NIE, en mayúsculas.
- **«Datadis limita el número de consultas»**: Datadis ha rechazado las
  consultas temporalmente; la integración lo vuelve a intentar más tarde por
  sí sola.
- **No hay datos de ayer**: es normal, las distribuidoras publican las
  lecturas con uno o dos días de retraso (a veces más).
- Registros: abra los registros de la integración desde Gladys
  (`LOG_LEVEL=debug` para todo el detalle). Las contraseñas, los tokens y los
  CUPS completos nunca se registran.

## Privacidad

La integración solo se comunica con datadis.es. Guarda una caché de las
lecturas en su propio volumen `/data` (nunca la contraseña) para no volver a
leer nada tras un reinicio.
