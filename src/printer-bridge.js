// Talks to the Android Bluetooth plugin (TallyBluetoothPlugin.java). Only works inside the Android app.
import { Capacitor, registerPlugin } from "@capacitor/core";

const BT = registerPlugin("TallyBluetooth");

export const printerAvailable = () => Capacitor.isNativePlatform();
export const bluetoothStatus = () => BT.status();
export async function listPairedDevices() { const r = await BT.listPaired(); return r.devices || []; }
export const sendToPrinter = (address, base64) => BT.print({ address, data: base64 });
export const openBluetoothSettings = () => BT.openBluetoothSettings();
