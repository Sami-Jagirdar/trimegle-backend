declare global {
     interface User {
        id: string;
        username: string;
    }

    interface Room {
        id: string;
        members: User[];
        available: boolean;
    }
}

export {};
