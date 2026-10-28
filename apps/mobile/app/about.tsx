/** Información honesta sobre qué depende del dispositivo (escáner, impresión, red local). */
import React from 'react';
import { Card, H2, Muted, P, Screen } from '../src/components/ui';

export default function About() {
  return (
    <Screen>
      <Card>
        <H2>Escáner de códigos</H2>
        <P>Se piden estos tipos a la cámara: Code 128, EAN-13, EAN-8, UPC-A, UPC-E y QR.</P>
        <Muted>
          Lo que realmente se lee depende de tu teléfono (cámara, enfoque, lector del sistema), de la luz y de la calidad de la etiqueta. Algunos equipos entregan UPC-A como EAN-13 con un cero al inicio; la búsqueda prueba ambas formas. Si un código no se lee, escríbelo a mano.
        </Muted>
      </Card>
      <Card>
        <H2>Impresión de tickets</H2>
        <P>Hay tres caminos:</P>
        <Muted>1. Pedir a la PC vinculada que imprima las 2 copias (cliente y tienda): es lo más fiable si la impresora térmica está en la PC.</Muted>
        <Muted>2. Servicio de impresión de Android: funciona con impresoras de red compatibles con el sistema; las térmicas Bluetooth normalmente no aparecen ahí.</Muted>
        <Muted>3. Guardar PDF y compartirlo.</Muted>
        <Muted>La impresión directa a impresoras Bluetooth o de red por ESC/POS requiere una biblioteca nativa que esta versión no incluye. Si no hay impresora, el ticket queda guardado y se reimprime después con el mismo folio.</Muted>
      </Card>
      <Card>
        <H2>Red local con la PC</H2>
        <Muted>El enlace con la PC usa HTTP sin cifrar dentro de tu red. Está firmado (nadie puede falsificar órdenes sin la llave), pero su contenido es visible en la red: no lo uses en Wi-Fi público. La hora del teléfono y la de la PC deben coincidir (máximo 1 minuto de diferencia).</Muted>
      </Card>
      <Card>
        <H2>Sin conexión</H2>
        <Muted>Las ventas, entradas y movimientos se guardan en el teléfono y se envían al reconectar. Las existencias y precios son los de la última sincronización más lo hecho en este teléfono; otras terminales pueden haber cambiado cosas.</Muted>
      </Card>
    </Screen>
  );
}
