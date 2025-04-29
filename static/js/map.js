// Map variables - declarados en el ámbito global para que sean accesibles desde main.js
window.map = null;
window.markers = {};
window.infoWindow = null;
window.googleMapsLoaded = false;
window.mapPendingCallbacks = [];

// Referencias locales para uso interno en este archivo
let map = window.map;
let markers = window.markers;
let infoWindow = window.infoWindow;
let googleMapsLoaded = window.googleMapsLoaded;
let mapPendingCallbacks = window.mapPendingCallbacks;

// Acceso a las variables compartidas con main.js
// selectedMachineId se declara en main.js

// Definir colores según el tipo de máquina para Google Maps
const machineColors = {
    'default': '#28a745', // Verde por defecto
    'Tractor': '#28a745', // Verde
    'Harvester': '#dc3545', // Rojo
    'Tracked Harvester': '#dc3545', // Rojo
    'Forwarder': '#fd7e14', // Naranja
    'Skidder': '#6f42c1', // Violeta
    'Excavator': '#ffc107', // Amarillo
    'Truck': '#17a2b8', // Azul claro
    'Vehicle': '#007bff', // Azul
    'Two-wheel Drive Tractors - 140 Hp And Above': '#28a745' // Verde
};

// Cargar Google Maps API de forma asíncrona
function loadGoogleMaps() {
    // Si ya se está cargando o ya está cargado, no hacer nada
    if (window.googleMapsLoading || googleMapsLoaded) {
        return;
    }
    
    console.log("Verificando estado de Google Maps API...");
    window.googleMapsLoading = true;
    
    // Comprobar si la API de Google Maps ya está disponible
    if (window.google && window.google.maps) {
        console.log("Google Maps API ya está disponible, no necesita cargarse de nuevo");
        googleMapsLoaded = true;
        window.googleMapsLoaded = true;
        
        // Inicializar el mapa
        initMapImpl();
        
        // Llamar a todas las funciones pendientes
        while (mapPendingCallbacks.length > 0) {
            const callback = mapPendingCallbacks.shift();
            callback();
        }
        return;
    }
    
    console.log("Esperando a que Google Maps API se cargue (ya debería estar cargándose en base.html)...");
    
    // En lugar de cargar un nuevo script, verificamos periódicamente si la API ya está cargada
    const checkGoogleMapsLoaded = setInterval(function() {
        if (window.google && window.google.maps) {
            clearInterval(checkGoogleMapsLoaded);
            console.log("Google Maps API cargada correctamente (detectado)");
            googleMapsLoaded = true;
            window.googleMapsLoaded = true;
            
            // Inicializar el mapa
            initMapImpl();
            
            // Llamar a todas las funciones pendientes
            while (mapPendingCallbacks.length > 0) {
                const callback = mapPendingCallbacks.shift();
                callback();
            }
        }
    }, 200); // Comprobar cada 200ms
}

// Wrapper para las funciones que dependen de Google Maps
// Si Google Maps aún no está cargado, guarda la función para ejecutarla más tarde
function withGoogleMaps(callback) {
    if (googleMapsLoaded) {
        callback();
    } else {
        console.log("Google Maps todavía no está cargado, añadiendo a la cola...");
        mapPendingCallbacks.push(callback);
        
        // Asegurarse de que se cargue Google Maps si aún no se ha iniciado
        loadGoogleMaps();
    }
}

// Función para obtener el tipo de máquina como string
function getMachineType(machine) {
    // Intentar conseguir el tipo desde la propiedad type (que puede ser un objeto o string)
    let machineType = '';
    
    if (machine.type) {
        if (typeof machine.type === 'object' && machine.type.name) {
            machineType = machine.type.name;
        } else if (typeof machine.type === 'string') {
            machineType = machine.type;
        }
    }
    
    return machineType;
}

// Definir colores según la severidad de la alerta
const alertColors = {
    'high': '#dc3545',     // Rojo para alertas de alta severidad
    'medium': '#ffc107',   // Amarillo para alertas de severidad media
    'low': '#6c757d',      // Gris para alertas de baja severidad
    'info': '#17a2b8',     // Azul para alertas informativas
    'dtc': '#6c757d',      // Gris para alertas DTC
    'unknown': '#6c757d',  // Gris para alertas de severidad desconocida
    'default': '#28a745'   // Verde por defecto (sin alertas)
};

// Función para obtener el color según el tipo de máquina y sus alertas
function getMachineColor(machine) {
    // Primero verificar si la máquina tiene alertas
    if (window.machineAlerts && machine.id && window.machineAlerts[machine.id]) {
        const alerts = window.machineAlerts[machine.id];
        
        // Si hay alertas, determinar el color según la alerta de mayor severidad
        if (alerts && alerts.length > 0) {
            // Prioridad de severidad: high > medium > low > info > dtc/unknown
            let highestSeverity = 'default';
            
            // Buscar la alerta con la mayor severidad
            for (const alert of alerts) {
                if (!alert.severity) continue;
                
                const severityLower = String(alert.severity).toLowerCase();
                
                // Orden de prioridad para severidades
                if (severityLower === 'high') {
                    highestSeverity = 'high';
                    break; // Si encontramos una alerta alta, ya no necesitamos seguir buscando
                } else if (severityLower === 'medium' && highestSeverity !== 'high') {
                    highestSeverity = 'medium';
                } else if (severityLower === 'low' && !['high', 'medium'].includes(highestSeverity)) {
                    highestSeverity = 'low';
                } else if (severityLower === 'info' && !['high', 'medium', 'low'].includes(highestSeverity)) {
                    highestSeverity = 'info';
                } else if ((severityLower === 'dtc' || severityLower === 'unknown') && 
                           !['high', 'medium', 'low', 'info'].includes(highestSeverity)) {
                    highestSeverity = severityLower;
                }
            }
            
            // Devolver el color según la severidad más alta encontrada
            return alertColors[highestSeverity];
        }
    }
    
    // Si no hay alertas, usar el color basado en el tipo de máquina
    const machineType = getMachineType(machine);
    return machineColors[machineType] || machineColors['default'];
}

// Función auxiliar para encontrar la severidad más alta en un conjunto de alertas
function findHighestSeverityAlert(alerts) {
    if (!alerts || alerts.length === 0) {
        return 'default';
    }
    
    // Prioridad de severidad: high > medium > low > info > dtc/unknown
    let highestSeverity = 'default';
    
    // Buscar la alerta con la mayor severidad
    for (const alert of alerts) {
        if (!alert.severity) continue;
        
        const severityLower = String(alert.severity).toLowerCase();
        
        // Orden de prioridad para severidades
        if (severityLower === 'high') {
            highestSeverity = 'high';
            break; // Si encontramos una alerta alta, ya no necesitamos seguir buscando
        } else if (severityLower === 'medium' && highestSeverity !== 'high') {
            highestSeverity = 'medium';
        } else if (severityLower === 'low' && !['high', 'medium'].includes(highestSeverity)) {
            highestSeverity = 'low';
        } else if (severityLower === 'info' && !['high', 'medium', 'low'].includes(highestSeverity)) {
            highestSeverity = 'info';
        } else if ((severityLower === 'dtc' || severityLower === 'unknown') && 
                   !['high', 'medium', 'low', 'info'].includes(highestSeverity)) {
            highestSeverity = severityLower;
        }
    }
    
    return highestSeverity;
}

// Iniciar la carga de Google Maps
loadGoogleMaps();

// Initialize the map - wrapper function que se llama desde DOMContentLoaded
// Esta función debe estar disponible globalmente
window.initMap = function() {
    console.log("Inicializando mapa desde initMap global");
    // Si Google Maps ya está cargado, inicializar inmediatamente
    // Si no, se iniciará automáticamente cuando se cargue la API
    if (googleMapsLoaded) {
        initMapImpl();
    } else {
        console.log("Google Maps aún no está cargado, se iniciará cuando esté disponible");
        // Asegurar que Google Maps se cargue
        loadGoogleMaps();
    }
};

// Asegurarse de que la inicialización ocurra cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    console.log("DOMContentLoaded en map.js - Intentando inicializar el mapa");
    // Verificar si el mapa está presente en la página (antiguo ID 'map' o nuevo ID 'simple-map-image')
    if (document.getElementById('map') || document.getElementById('simple-map-image')) {
        console.log("Elemento del mapa encontrado, inicializando...");
        // Intentar inicializar el mapa
        window.initMap();
    } else {
        console.log("No se encontró el elemento del mapa en la página actual");
    }
});

// Implementación real de la inicialización del mapa
function initMapImpl() {
    console.log("Inicializando Google Maps...");
    
    try {
        // Verificar si el elemento map existe (con cualquiera de los dos IDs posibles)
        let mapElement = document.getElementById('map');
        if (!mapElement) {
            // Si no encuentra 'map', intentar con 'simple-map-image'
            mapElement = document.getElementById('simple-map-image');
            if (!mapElement) {
                console.error("Error: No se encontró ningún elemento de mapa válido ('map' o 'simple-map-image')");
                return;
            }
        }
        
        console.log("Elemento del mapa encontrado:", mapElement);
        
        // Asegurarse de que el elemento tenga dimensiones
        if (mapElement.offsetWidth === 0 || mapElement.offsetHeight === 0) {
            console.warn("El elemento del mapa tiene dimensiones cero. Estableciendo dimensiones explícitas.");
            mapElement.style.height = "500px";
            mapElement.style.width = "100%";
        }
        
        // Info window compartida para todos los marcadores
        infoWindow = new google.maps.InfoWindow();
        window.infoWindow = infoWindow;
        
        // Crear mapa centrado en una ubicación predeterminada (centro de Chile si no hay datos)
        map = new google.maps.Map(mapElement, {
            center: { lat: -33.4489, lng: -70.6693 }, // Santiago, Chile
            zoom: 5,
            mapTypeId: google.maps.MapTypeId.SATELLITE, // Usar vista de satélite por defecto
            mapTypeControl: true,
            fullscreenControl: true,
            streetViewControl: false,
            mapTypeControlOptions: {
                style: google.maps.MapTypeControlStyle.DROPDOWN_MENU
            }
        });
        
        // Actualizar la referencia global al mapa
        window.map = map;
        
        console.log("Mapa de Google Maps inicializado correctamente");
        
        // Disparar un evento personalizado para notificar que el mapa está listo
        const mapReadyEvent = new Event('mapReady');
        document.dispatchEvent(mapReadyEvent);
    } catch (error) {
        console.error("Error al inicializar el mapa:", error);
        console.error("Detalles del error:", error.message);
        console.error("Stack trace:", error.stack);
    }
}

// Add machines to the map - Exposición global para que main.js pueda acceder
window.addMachinesToMap = function(machines) {
    console.log(`Añadiendo ${machines.length} máquinas al mapa desde función global`);
    
    // Llamamos a la función local que ya tiene toda la implementación
    addMachinesToMap(machines);
};

// Función local para compatibilidad interna del archivo
function addMachinesToMap(machines) {
    console.log(`Añadiendo ${machines.length} máquinas al mapa desde función local`);
    
    // Usar el wrapper para asegurarnos de que Google Maps está cargado
    withGoogleMaps(() => {
        // Clear existing markers
        clearMapMarkers();
        
        // Bounds to fit all markers
        const bounds = new google.maps.LatLngBounds();
        let validLocations = 0;
        
        // Para grandes cantidades de máquinas, mostrar solo las primeras 50 con localización
        // para evitar sobrecargar el mapa y mejorar rendimiento
        const MAX_MARKERS = 50;
        let markersAdded = 0;
        let hasLimitedMarkers = false;
        
        // Primero, añadir máquina seleccionada si existe
        if (selectedMachineId) {
            const selectedMachine = machines.find(m => m.id === selectedMachineId);
            if (selectedMachine && selectedMachine.location && 
                selectedMachine.location.latitude && selectedMachine.location.longitude) {
                addSingleMachineToMap(selectedMachine, bounds);
                validLocations++;
                markersAdded++;
            }
        }
        
        // Luego añadir el resto hasta el límite
        for (const machine of machines) {
            // Si ya tenemos la máquina seleccionada, saltarla
            if (selectedMachineId && machine.id === selectedMachineId) {
                continue;
            }
            
            if (machine.location && machine.location.latitude && machine.location.longitude) {
                // Si alcanzamos el límite, detenernos
                if (markersAdded >= MAX_MARKERS) {
                    hasLimitedMarkers = true;
                    break;
                }
                
                addSingleMachineToMap(machine, bounds);
                validLocations++;
                markersAdded++;
            }
        }
        
        // Si tenemos ubicaciones válidas, ajustar el mapa a esos límites
        if (validLocations > 0) {
            map.fitBounds(bounds);
            
            // Limitar el zoom máximo para no acercarse demasiado si solo hay un marcador
            if (validLocations === 1) {
                google.maps.event.addListenerOnce(map, 'bounds_changed', function() {
                    if (map.getZoom() > 15) map.setZoom(15);
                });
            }
        }
        
        // Si hemos limitado los marcadores, mostrar un mensaje
        if (hasLimitedMarkers) {
            // Crear un control de información personalizado
            const limitInfoDiv = document.createElement('div');
            limitInfoDiv.className = 'map-info-control';
            limitInfoDiv.innerHTML = `
                <div class="alert alert-info p-2 m-0" style="font-size: 0.8rem; opacity: 0.9;">
                    <i class="fas fa-info-circle"></i> 
                    Mostrando ${markersAdded} de ${machines.filter(m => m.location && 
                    m.location.latitude && m.location.longitude).length} ubicaciones.
                </div>`;
            
            // Estilos CSS para el control personalizado
            limitInfoDiv.style.margin = '10px';
            limitInfoDiv.style.padding = '5px';
            limitInfoDiv.style.backgroundColor = 'white';
            limitInfoDiv.style.border = '1px solid #ccc';
            limitInfoDiv.style.borderRadius = '4px';
            limitInfoDiv.style.boxShadow = '0 2px 6px rgba(0,0,0,.3)';
            
            // Añadir el control al mapa
            map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(limitInfoDiv);
        }
        
        console.log(`Añadidos ${markersAdded} marcadores al mapa`);
    });
}

// Función auxiliar para añadir una máquina al mapa
function addSingleMachineToMap(machine, bounds) {
    // Crear posición para Google Maps
    const position = {
        lat: parseFloat(machine.location.latitude),
        lng: parseFloat(machine.location.longitude)
    };
    
    // Determinar si esta máquina está seleccionada
    const isSelected = selectedMachineId && machine.id === selectedMachineId;
    
    // Obtener el color según las alertas de la máquina
    const color = getMachineColor(machine);
    
    // Para máquinas seleccionadas, usar un tamaño más grande y color dorado
    const scale = isSelected ? 1.3 : 1.0;
    const fillColor = isSelected ? '#FFD700' : color; // Dorado para seleccionadas
    
    // Seleccionar ícono personalizado según el color de la alerta o tipo de máquina
    let iconUrl;
    
    // Si está seleccionada, usar ícono dorado
    if (isSelected) {
        iconUrl = 'https://maps.google.com/mapfiles/ms/icons/yellow-dot.png';
    } 
    // Si la máquina tiene alertas, seleccionar ícono según la severidad de la alerta
    else if (window.machineAlerts && machine.id && window.machineAlerts[machine.id] && 
             window.machineAlerts[machine.id].length > 0) {
        // Determinar el color del ícono según la alerta con la mayor severidad
        const highestSeverityAlert = findHighestSeverityAlert(window.machineAlerts[machine.id]);
        
        // Seleccionar ícono por severidad
        switch (highestSeverityAlert) {
            case 'high':
                iconUrl = 'https://maps.google.com/mapfiles/ms/icons/red-dot.png';
                break;
            case 'medium':
                iconUrl = 'https://maps.google.com/mapfiles/ms/icons/yellow-dot.png';
                break;
            case 'low':
                iconUrl = 'https://maps.google.com/mapfiles/ms/icons/gray-dot.png';
                break;
            case 'info':
                iconUrl = 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png';
                break;
            case 'dtc':
            case 'unknown':
                iconUrl = 'https://maps.google.com/mapfiles/ms/icons/purple-dot.png';
                break;
            default:
                iconUrl = 'https://maps.google.com/mapfiles/ms/icons/green-dot.png';
        }
    } 
    // Si no hay alertas, usar el ícono según el tipo de máquina
    else {
        // Seleccionar ícono según el tipo
        switch (getMachineType(machine)) {
            case 'Tractor':
                iconUrl = 'https://maps.google.com/mapfiles/ms/icons/green-dot.png';
                break;
            case 'Harvester':
            case 'Tracked Harvester':
                iconUrl = 'https://maps.google.com/mapfiles/ms/icons/red-dot.png';
                break;
            case 'Backhoes':
                iconUrl = 'https://maps.google.com/mapfiles/ms/icons/yellow-dot.png';
                break;
            case 'Excavator':
                iconUrl = 'https://maps.google.com/mapfiles/ms/icons/orange-dot.png';
                break;
            case 'Skidder':
                iconUrl = 'https://maps.google.com/mapfiles/ms/icons/purple-dot.png';
                break;
            case 'Truck':
                iconUrl = 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png';
                break;
            case 'Vehicle':
                iconUrl = 'https://maps.google.com/mapfiles/ms/icons/lightblue-dot.png';
                break;
            default:
                iconUrl = 'https://maps.google.com/mapfiles/ms/icons/green-dot.png';
        }
    }
    
    // Crear un marcador con ícono personalizado
    const marker = new google.maps.Marker({
        position: position,
        map: map,
        title: machine.name || `Máquina ${machine.id}`,
        icon: {
            url: iconUrl,
            scaledSize: new google.maps.Size(isSelected ? 42 : 35, isSelected ? 42 : 35), // Tamaño más grande para seleccionadas
            origin: new google.maps.Point(0, 0),
            anchor: new google.maps.Point(isSelected ? 21 : 17.5, isSelected ? 42 : 35)
        },
        zIndex: isSelected ? 1000 : 1 // Mayor zIndex para máquinas seleccionadas
    });
    
    // Añadir información de ventana emergente (InfoWindow)
    const popupContent = createMachinePopupContent(machine);
    
    marker.addListener('click', function() {
        infoWindow.setContent(popupContent);
        infoWindow.open(map, marker);
        // Seleccionar la máquina cuando se hace clic en el marcador
        selectMachine(machine.id);
    });
    
    // Almacenar el marcador con el ID de máquina como clave
    markers[machine.id] = marker;
    
    // Extender los límites para incluir este marcador
    bounds.extend(position);
}

// Create popup content for machine marker
function createMachinePopupContent(machine) {
    // Obtener información de ubicación y formatear datos
    const timestamp = machine.location && machine.location.timestamp ?
        new Date(machine.location.timestamp).toLocaleString() : 'Desconocido';
    
    // Formatear coordenadas con precisión de 6 decimales
    const latitude = machine.location && machine.location.latitude ? 
        parseFloat(machine.location.latitude).toFixed(6) : 'No disponible';
    const longitude = machine.location && machine.location.longitude ? 
        parseFloat(machine.location.longitude).toFixed(6) : 'No disponible';
    
    // Obtener modelo y tipo de máquina
    let modelText = 'Modelo desconocido';
    if (machine.model) {
        if (typeof machine.model === 'object' && machine.model.name) {
            modelText = machine.model.name;
        } else if (typeof machine.model === 'string') {
            modelText = machine.model;
        }
    }
    
    let machineType = '';
    if (machine.type) {
        if (typeof machine.type === 'object' && machine.type.name) {
            machineType = machine.type.name;
        } else if (typeof machine.type === 'string') {
            machineType = machine.type;
        }
    }
    
    // No necesitamos enlace a Google Maps ya que estamos usando el mapa directamente
    
    // Añadir información de horas de operación si está disponible
    const hoursInfo = machine.hoursOfOperation ? 
        `<div><strong>Horas de operación:</strong> ${machine.hoursOfOperation}</div>` : '';
    
    // Añadir información de nivel de combustible si está disponible
    const fuelInfo = machine.fuelLevel || machine.fuelLevel === 0 ? 
        `<div><strong>Nivel de combustible:</strong> ${machine.fuelLevel}%</div>` : '';
    
    // Construir el HTML para el popup
    return `
        <div class="machine-popup">
            <h6 class="mb-2">${machine.name || 'Sin nombre'}</h6>
            <div><strong>Modelo:</strong> ${modelText}</div>
            <div><strong>Tipo:</strong> ${machineType || 'No especificado'}</div>
            <div><strong>Categoría:</strong> ${machine.category || 'Sin categoría'}</div>
            ${hoursInfo}
            ${fuelInfo}
            
            <hr class="my-2">
            
            <div class="location-info">
                <div><strong>Latitud:</strong> ${latitude}</div>
                <div><strong>Longitud:</strong> ${longitude}</div>
                <div><strong>Última actualización:</strong> ${timestamp}</div>
            </div>
            
            <div class="d-flex justify-content-center mt-3">
                <button class="btn btn-sm btn-primary" onclick="selectMachine('${machine.id}')">
                    <i class="fas fa-info-circle me-1"></i> Ver detalles
                </button>
            </div>
        </div>
    `;
}

// Clear all markers from the map - Exposición global para que main.js pueda acceder
window.clearMapMarkers = function() {
    if (!window.googleMapsLoaded) {
        // Si Google Maps no está cargado, simplemente limpiar el objeto markers
        window.markers = {};
        markers = window.markers;
        return;
    }
    
    // Si hay marcadores activos, eliminarlos del mapa
    Object.values(window.markers).forEach(marker => {
        marker.setMap(null);
    });
    window.markers = {};
    markers = window.markers;
    console.log("Marcadores del mapa limpiados exitosamente");
}

// Función local para compatibilidad interna del archivo
function clearMapMarkers() {
    // Implementar directamente sin llamar a window.clearMapMarkers para evitar recursión
    if (!window.googleMapsLoaded) {
        // Si Google Maps no está cargado, simplemente limpiar el objeto markers
        window.markers = {};
        markers = window.markers;
        return;
    }
    
    // Si hay marcadores activos, eliminarlos del mapa
    Object.values(window.markers).forEach(marker => {
        marker.setMap(null);
    });
    window.markers = {};
    markers = window.markers;
    console.log("Marcadores del mapa limpiados localmente");
}

// Focus map on a specific machine
function focusMapOnMachine(machineId) {
    console.log(`Enfocando mapa en máquina: ${machineId}`);
    
    if (!machineId) {
        console.warn("ID de máquina no proporcionado para enfocar en el mapa");
        return;
    }

    // Guardar la selección en la variable global para que esté disponible para otros componentes
    window.selectedMachineId = machineId;

    // Use withGoogleMaps wrapper to make sure Google Maps API is loaded
    withGoogleMaps(() => {
        // Si el mapa no está inicializado, no hacer nada
        if (!map) {
            console.warn("El mapa no está inicializado todavía");
            mapPendingCallbacks.push(() => focusMapOnMachine(machineId));
            return;
        }
        
        // Primero, mostrar todos los marcadores pero con una opacidad reducida
        Object.entries(markers).forEach(([id, marker]) => {
            // Mostrar todos los marcadores
            marker.setVisible(true);
            // Si es el marcador seleccionado, mantener opacidad normal
            if (id === machineId) {
                marker.setOpacity(1.0);
            } else {
                // Reducir opacidad para los demás marcadores
                marker.setOpacity(0.5);
            }
        });

        // Si la máquina ya está en el mapa, usamos esos datos
        if (markers && markers[machineId]) {
            console.log("Usando marcador existente para enfoque:", machineId);
            
            const marker = markers[machineId];
            const position = marker.getPosition();
            
            // Centrar el mapa en la ubicación de la máquina
            map.setCenter(position);
            map.setZoom(15); // Establecer un zoom más cercano
            map.setMapTypeId(google.maps.MapTypeId.SATELLITE); // Mantener siempre en vista satélite
            
            // Animar el marcador para destacarlo
            if (marker.getAnimation() !== google.maps.Animation.BOUNCE) {
                marker.setAnimation(google.maps.Animation.BOUNCE);
                setTimeout(() => {
                    marker.setAnimation(null);
                }, 1500);
            }
            
            // Abrir la ventana de información para esta máquina
            if (window.lastLoadedMachines) {
                const machine = window.lastLoadedMachines.find(m => m.id === machineId);
                if (machine) {
                    infoWindow.setContent(createMachinePopupContent(machine));
                    infoWindow.open(map, marker);
                }
            }
            return;
        }
        
        // Si no encontramos el marcador, intentamos obtener los datos actualizados
        console.log("Obteniendo datos actualizados para la máquina:", machineId);
        
        // Obtener los datos de la máquina más actualizados
        fetch(`/api/machine/${machineId}`, {
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        })
    .then(response => {
        if (!response.ok) {
            throw new Error('Error al obtener ubicación actualizada de la máquina');
        }
        return response.json();
    })
    .then(machine => {
        console.log("Datos de ubicación obtenidos:", machine);
        
        // Verificar si tenemos una ubicación válida
        if (machine.location && machine.location.latitude && machine.location.longitude) {
            withGoogleMaps(() => {
                // Crear posición para Google Maps
                const position = {
                    lat: parseFloat(machine.location.latitude),
                    lng: parseFloat(machine.location.longitude)
                };
                
                console.log("Centrando mapa en posición:", position);
                
                // Centrar el mapa en la ubicación de la máquina
                map.setCenter(position);
                map.setZoom(15); // Establecer un zoom más cercano
                map.setMapTypeId(google.maps.MapTypeId.SATELLITE); // Mantener siempre en vista satélite
                
                // Si ya existe un marcador para esta máquina, usar ese
                if (markers[machineId]) {
                    // Actualizar la posición del marcador existente
                    markers[machineId].setPosition(position);
                    
                    // Abrir ventana de información
                    infoWindow.setContent(createMachinePopupContent(machine));
                    infoWindow.open(map, markers[machineId]);
                } else {
                    // Si no existe un marcador, crear uno nuevo
                    const isSelected = true; // Está seleccionada
                    
                    // Seleccionar ícono personalizado
                    const iconUrl = 'https://maps.google.com/mapfiles/ms/icons/yellow-dot.png';
                    
                    // Crear marcador
                    const marker = new google.maps.Marker({
                        position: position,
                        map: map,
                        title: machine.name || `Máquina ${machine.id}`,
                        icon: {
                            url: iconUrl,
                            scaledSize: new google.maps.Size(42, 42),
                            origin: new google.maps.Point(0, 0),
                            anchor: new google.maps.Point(21, 42)
                        },
                        zIndex: 1000, // Mayor zIndex para destacar
                        animation: google.maps.Animation.DROP // Animación para destacar
                    });
                    
                    // Añadir event listener y guardar el marcador
                    marker.addListener('click', function() {
                        infoWindow.setContent(createMachinePopupContent(machine));
                        infoWindow.open(map, marker);
                    });
                    
                    markers[machineId] = marker;
                    
                    // Abrir ventana de información
                    infoWindow.setContent(createMachinePopupContent(machine));
                    infoWindow.open(map, marker);
                }
                
                // Añadir efecto de rebote al marcador para destacarlo
                if (markers[machineId].getAnimation() !== google.maps.Animation.BOUNCE) {
                    markers[machineId].setAnimation(google.maps.Animation.BOUNCE);
                    // Detener la animación después de 2 segundos
                    setTimeout(() => {
                        markers[machineId].setAnimation(null);
                    }, 2000);
                }
                
                console.log(`Mapa centrado en lat: ${position.lat}, lng: ${position.lng}`);
            });
        } else {
            console.warn(`La máquina ${machineId} no tiene datos de ubicación válidos`);
            
            // Buscar el marcador existente como respaldo
            withGoogleMaps(() => {
                const marker = markers[machineId];
                if (marker) {
                    map.setCenter(marker.getPosition());
                    map.setZoom(14);
                    map.setMapTypeId(google.maps.MapTypeId.SATELLITE); // Mantener siempre en vista satélite
                    infoWindow.setContent(createMachinePopupContent(machine));
                    infoWindow.open(map, marker);
                } else {
                    console.warn(`No hay marcador existente para la máquina ${machineId}`);
                }
            });
        }
    })
    .catch(error => {
        console.error(`Error al enfocar máquina ${machineId}:`, error);
        
        // Método de respaldo usando los datos locales
        withGoogleMaps(() => {
            const marker = markers[machineId];
            if (marker) {
                map.setCenter(marker.getPosition());
                map.setZoom(14);
                map.setMapTypeId(google.maps.MapTypeId.SATELLITE); // Mantener siempre en vista satélite
                
                // Buscar los datos de la máquina en la memoria local
                const localMachineData = window.lastLoadedMachines?.find(m => m.id === machineId);
                if (localMachineData) {
                    infoWindow.setContent(createMachinePopupContent(localMachineData));
                    infoWindow.open(map, marker);
                }
            } else {
                console.warn(`No hay marcador para la máquina ${machineId}`);
            }
        });
    });
}
