// Map variables
let map;
let markers = {};

// Initialize the map
function initMap() {
    // Create map centered on a default location (center of USA if no data)
    map = L.map('map').setView([40.0, -95.0], 4);
    
    // Add the OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);
    
    // Add a scale control
    L.control.scale().addTo(map);
}

// Add machines to the map
function addMachinesToMap(machines) {
    // Clear existing markers
    clearMapMarkers();
    
    // Bounds to fit all markers
    const bounds = L.latLngBounds();
    let validLocations = 0;
    
    // Add each machine with location to the map
    machines.forEach(machine => {
        if (machine.location && machine.location.lat && machine.location.lng) {
            const position = [machine.location.lat, machine.location.lng];
            
            // Create a marker with popup
            const marker = L.marker(position)
                .bindPopup(createMachinePopupContent(machine));
                
            // Store marker with machine ID as key
            markers[machine.id] = marker;
            
            // Add marker to map
            marker.addTo(map);
            
            // Add click event to select machine when marker is clicked
            marker.on('click', function() {
                selectMachine(machine.id);
            });
            
            // Extend bounds to include this marker
            bounds.extend(position);
            validLocations++;
        }
    });
    
    // If we have valid locations, fit the map to bounds
    if (validLocations > 0) {
        map.fitBounds(bounds, {
            padding: [50, 50],
            maxZoom: 12
        });
    }
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
        map.removeLayer(marker);
    });
    markers = {};
}

// Focus map on a specific machine
function focusMapOnMachine(machineId) {
    const marker = markers[machineId];
    if (marker) {
        map.setView(marker.getLatLng(), 14);
        marker.openPopup();
    }
}
