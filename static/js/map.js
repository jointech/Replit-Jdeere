// Map variables
let map;
let markers = {};
let infoWindow;

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

// Función para obtener el color según el tipo de máquina
function getMachineColor(machine) {
    // Intentar conseguir el tipo desde la propiedad type (que puede ser un objeto o string)
    let machineType = '';
    
    if (machine.type) {
        if (typeof machine.type === 'object' && machine.type.name) {
            machineType = machine.type.name;
        } else if (typeof machine.type === 'string') {
            machineType = machine.type;
        }
    }
    
    // Si no hay un color específico para este tipo, usar el color predeterminado
    return machineColors[machineType] || machineColors['default'];
}

// Initialize the map
function initMap() {
    // Info window compartida para todos los marcadores
    infoWindow = new google.maps.InfoWindow();
    
    // Crear mapa centrado en una ubicación predeterminada (centro de Chile si no hay datos)
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: -33.4489, lng: -70.6693 }, // Santiago, Chile
        zoom: 5,
        mapTypeId: google.maps.MapTypeId.ROADMAP,
        mapTypeControl: true,
        fullscreenControl: true,
        streetViewControl: false,
        mapTypeControlOptions: {
            style: google.maps.MapTypeControlStyle.DROPDOWN_MENU
        }
    });
}

// Add machines to the map
function addMachinesToMap(machines) {
    console.log(`Añadiendo ${machines.length} máquinas al mapa`);
    
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
    
    // Obtener el color según el tipo de máquina
    const color = getMachineColor(machine);
    
    // Para máquinas seleccionadas, usar un tamaño más grande y color dorado
    const scale = isSelected ? 1.3 : 1.0;
    const fillColor = isSelected ? '#FFD700' : color; // Dorado para seleccionadas
    
    // Crear un marcador con ícono personalizado
    const marker = new google.maps.Marker({
        position: position,
        map: map,
        title: machine.name || `Máquina ${machine.id}`,
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: fillColor,
            fillOpacity: 0.9,
            strokeWeight: 2,
            strokeColor: '#FFFFFF',
            scale: 8 * scale // Tamaño base * factor de escala
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
    const timestamp = machine.location && machine.location.timestamp ?
        new Date(machine.location.timestamp).toLocaleString() : 'Desconocido';
    
    return `
        <div class="machine-popup">
            <h6>${machine.name || 'Sin nombre'}</h6>
            <div><strong>Modelo:</strong> ${machine.model || 'Desconocido'}</div>
            <div><strong>Categoría:</strong> ${machine.category || 'Sin categoría'}</div>
            <div><strong>Última actualización:</strong> ${timestamp}</div>
            <div class="mt-2">
                <button class="btn btn-sm btn-primary" onclick="selectMachine('${machine.id}')">
                    Ver detalles
                </button>
            </div>
        </div>
    `;
}

// Clear all markers from the map
function clearMapMarkers() {
    Object.values(markers).forEach(marker => {
        marker.setMap(null);
    });
    markers = {};
}

// Focus map on a specific machine
function focusMapOnMachine(machineId) {
    const marker = markers[machineId];
    if (marker) {
        map.setCenter(marker.getPosition());
        map.setZoom(14);
        infoWindow.setContent(createMachinePopupContent(
            window.lastLoadedMachines.find(m => m.id === machineId)
        ));
        infoWindow.open(map, marker);
    }
}
