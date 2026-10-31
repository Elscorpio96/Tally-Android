package com.tally.shopledger;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.Set;
import java.util.UUID;

/**
 * Classic Bluetooth (SPP / RFCOMM) printing for ESC/POS thermal receipt printers.
 * The printer must first be paired in Android's Bluetooth settings.
 * Each print opens a connection, sends the bytes, and closes it, so a printer that went to sleep still works.
 */
@SuppressLint("MissingPermission")
@CapacitorPlugin(
    name = "TallyBluetooth",
    permissions = { @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT }) }
)
public class TallyBluetoothPlugin extends Plugin {

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return m == null ? null : m.getAdapter();
    }

    /** Android 12+ needs the runtime "Nearby devices" permission; older versions use install-time permissions. */
    private boolean needsPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }

    @PluginMethod
    public void status(PluginCall call) {
        BluetoothAdapter a = adapter();
        JSObject r = new JSObject();
        r.put("supported", a != null);
        r.put("enabled", a != null && a.isEnabled());
        r.put("permission", !needsPermission());
        call.resolve(r);
    }

    @PluginMethod
    public void listPaired(PluginCall call) {
        if (needsPermission()) {
            requestPermissionForAlias("bluetooth", call, "permissionCallback");
            return;
        }
        doList(call);
    }

    @PluginMethod
    public void print(PluginCall call) {
        if (needsPermission()) {
            requestPermissionForAlias("bluetooth", call, "permissionCallback");
            return;
        }
        doPrint(call);
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (needsPermission()) {
            call.reject("Bluetooth permission was denied. Allow \"Nearby devices\" for this app in the phone's Settings > Apps.", "PERMISSION_DENIED");
            return;
        }
        if ("print".equals(call.getMethodName())) {
            doPrint(call);
        } else {
            doList(call);
        }
    }

    @PluginMethod
    public void openBluetoothSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open Bluetooth settings.");
        }
    }

    private void doList(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null) {
            call.reject("This phone has no Bluetooth.", "NO_BLUETOOTH");
            return;
        }
        if (!a.isEnabled()) {
            call.reject("Bluetooth is turned off. Turn it on and try again.", "BT_OFF");
            return;
        }
        JSArray arr = new JSArray();
        try {
            Set<BluetoothDevice> bonded = a.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice d : bonded) {
                    JSObject o = new JSObject();
                    String name = d.getName();
                    o.put("name", name == null ? "" : name);
                    o.put("address", d.getAddress());
                    BluetoothClass c = d.getBluetoothClass();
                    boolean printer = c != null && c.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING;
                    o.put("printer", printer);
                    arr.put(o);
                }
            }
        } catch (SecurityException e) {
            call.reject("Bluetooth permission was denied.", "PERMISSION_DENIED");
            return;
        }
        JSObject r = new JSObject();
        r.put("devices", arr);
        call.resolve(r);
    }

    private void doPrint(final PluginCall call) {
        final String address = call.getString("address");
        final String data = call.getString("data");
        if (address == null || data == null) {
            call.reject("Missing printer address or print data.");
            return;
        }
        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("The print data was not valid.");
            return;
        }
        new Thread(() -> {
            BluetoothSocket socket = null;
            try {
                BluetoothAdapter a = adapter();
                if (a == null || !a.isEnabled()) {
                    call.reject("Bluetooth is turned off. Turn it on and try again.", "BT_OFF");
                    return;
                }
                BluetoothDevice dev = a.getRemoteDevice(address);
                socket = connect(dev);
                OutputStream out = socket.getOutputStream();
                final int chunk = 512; // small chunks + short pauses so cheap printers don't drop data
                for (int i = 0; i < bytes.length; i += chunk) {
                    int n = Math.min(chunk, bytes.length - i);
                    out.write(bytes, i, n);
                    out.flush();
                    Thread.sleep(30);
                }
                Thread.sleep(500); // let the printer finish before the link closes
                call.resolve();
            } catch (Exception e) {
                String why = e.getMessage() == null ? "printer not reachable" : e.getMessage();
                call.reject("Could not print (" + why + "). Check the printer is on, nearby and paired.", "PRINT_FAILED");
            } finally {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (IOException ignored) {
                    }
                }
            }
        }).start();
    }

    private BluetoothSocket connect(BluetoothDevice dev) throws IOException {
        BluetoothSocket s = null;
        try {
            s = dev.createRfcommSocketToServiceRecord(SPP);
            s.connect();
            return s;
        } catch (IOException first) {
            try {
                if (s != null) s.close();
            } catch (IOException ignored) {
            }
            // Fallback some cheap printers need.
            try {
                Method m = dev.getClass().getMethod("createRfcommSocket", int.class);
                BluetoothSocket fb = (BluetoothSocket) m.invoke(dev, 1);
                fb.connect();
                return fb;
            } catch (Exception second) {
                throw first;
            }
        }
    }
}
